import AppKit
import CryptoKit
import Foundation
import UserNotifications

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private lazy var controlApp = ManagedProcess(label: "Control app", logName: "control-app.log") { [weak self] in
        self?.refreshMenu()
    }
    private lazy var daemon = ManagedProcess(label: "Clipboard daemon", logName: "clipboard-daemon.log") { [weak self] in
        self?.refreshMenu()
    }
    private lazy var agentListener = ManagedProcess(label: "Agent listener", logName: "agent-listener.log") { [weak self] in
        self?.refreshMenu()
    }
    private lazy var updater = UpdateChecker()
    private var statusMenuItem = NSMenuItem(title: "Status: Starting", action: nil, keyEquivalent: "")
    private var controlToggleItem = NSMenuItem()
    private var agentListenerToggleItem = NSMenuItem()
    private var daemonToggleItem = NSMenuItem()
    private var controlAppExternalAvailable = false
    private var controlAppSupportsAgentHandshake = false
    private var agentListenerNeedsAttention = false
    private var notifiedTransportIds = Set<String>()
    private var notifiedApprovalIds = Set<String>()
    private var pendingApprovals: [ApprovalSummary] = []
    private var pendingApprovalCount = 0
    private let detailPreferenceKey = "ConduitApprovalDetailsPreference"
    private var healthTimer: Timer?
    private var terminationConfirmed = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
        requestNotificationAuthorization()
        configureStatusItem()
        rebuildMenu()
        if (try? PortListeners.listenerPids(on: 47831).isEmpty) == true {
            startControlApp()
        } else {
            refreshControlAppHealth()
        }
        startAgentListener()
        startDaemon()
        healthTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.refreshControlAppHealth()
            self?.refreshApprovalNotifications()
            self?.refreshAgentListenerHealth()
        }
        scheduleStartupUpdateCheck()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if terminationConfirmed {
            return .terminateNow
        }
        return confirmTermination() ? .terminateNow : .terminateCancel
    }

    func applicationWillTerminate(_ notification: Notification) {
        healthTimer?.invalidate()
        controlApp.stop()
        agentListener.stop()
        daemon.stop()
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls where url.scheme == "conduit" {
            handleConduitURL(url)
        }
    }

    private func configureStatusItem() {
        if let button = statusItem.button {
            button.image = ConduitIcon.makeStatusImage()
            button.image?.isTemplate = true
            button.toolTip = "Conduit"
        }
    }

    private func rebuildMenu() {
        let menu = NSMenu()
        statusMenuItem = NSMenuItem(title: statusTitle(), action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)
        menu.addItem(NSMenuItem.separator())

        controlToggleItem = NSMenuItem(
            title: controlAppToggleTitle(),
            action: #selector(toggleControlApp),
            keyEquivalent: ""
        )
        controlToggleItem.target = self
        controlToggleItem.isEnabled = controlAppToggleEnabled()
        menu.addItem(controlToggleItem)

        let openItem = NSMenuItem(title: "Open Control Panel", action: #selector(openControlPanel), keyEquivalent: "o")
        openItem.target = self
        menu.addItem(openItem)

        let handshakeItem = NSMenuItem(title: "Copy Agent Handshake", action: #selector(copyAgentHandshake), keyEquivalent: "h")
        handshakeItem.target = self
        menu.addItem(handshakeItem)

        if !pendingApprovals.isEmpty {
            menu.addItem(NSMenuItem.separator())
            let approvalsHeader = NSMenuItem(title: "Pending Approvals", action: nil, keyEquivalent: "")
            approvalsHeader.isEnabled = false
            menu.addItem(approvalsHeader)
            for approval in pendingApprovals.prefix(5) {
                menu.addItem(approvalMenuItem(for: approval))
            }
            if pendingApprovals.count > 5 {
                let overflowItem = NSMenuItem(title: "\(pendingApprovals.count - 5) more in Control Panel...", action: #selector(openControlPanelApprovals), keyEquivalent: "")
                overflowItem.target = self
                menu.addItem(overflowItem)
            }
        }

        agentListenerToggleItem = NSMenuItem(
            title: agentListener.isRunning ? "Stop Agent Listener" : "Start Agent Listener",
            action: #selector(toggleAgentListener),
            keyEquivalent: ""
        )
        agentListenerToggleItem.target = self
        menu.addItem(agentListenerToggleItem)

        daemonToggleItem = NSMenuItem(
            title: daemon.isRunning ? "Stop Clipboard Daemon" : "Start Clipboard Daemon",
            action: #selector(toggleDaemon),
            keyEquivalent: ""
        )
        daemonToggleItem.target = self
        menu.addItem(daemonToggleItem)

        menu.addItem(NSMenuItem.separator())

        let updateItem = NSMenuItem(title: "Check for Updates...", action: #selector(checkForUpdatesFromMenu), keyEquivalent: "u")
        updateItem.target = self
        menu.addItem(updateItem)

        let logsItem = NSMenuItem(title: "Open Logs", action: #selector(openLogs), keyEquivalent: "l")
        logsItem.target = self
        menu.addItem(logsItem)

        let bugItem = NSMenuItem(title: "Report Bug", action: #selector(reportBug), keyEquivalent: "b")
        bugItem.target = self
        menu.addItem(bugItem)

        menu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(title: "Quit Conduit", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    private func statusTitle() -> String {
        let control = "control \(controlAppStatusSummary())"
        let agentState = agentListenerNeedsAttention ? "agent needs attention" : "agent \(agentListener.statusSummary)"
        let daemonState = "daemon \(daemon.statusSummary)"
        let approvals = pendingApprovalCount > 0 ? ", approvals \(pendingApprovalCount) pending" : ""
        return "Status: \(control), \(agentState), \(daemonState)\(approvals)"
    }

    private func refreshMenu() {
        statusMenuItem.title = statusTitle()
        controlToggleItem.title = controlAppToggleTitle()
        controlToggleItem.isEnabled = controlAppToggleEnabled()
        agentListenerToggleItem.title = agentListener.isRunning ? "Stop Agent Listener" : "Start Agent Listener"
        daemonToggleItem.title = daemon.isRunning ? "Stop Clipboard Daemon" : "Start Clipboard Daemon"
    }

    private func approvalMenuItem(for approval: ApprovalSummary) -> NSMenuItem {
        let item = NSMenuItem(title: approvalMenuTitle(for: approval), action: nil, keyEquivalent: "")
        let submenu = NSMenu()

        let reason = approvalDisplaySubtitle(for: approval)
        let reasonItem = NSMenuItem(title: reason, action: nil, keyEquivalent: "")
        reasonItem.isEnabled = false
        submenu.addItem(reasonItem)

        let approveItem = NSMenuItem(
            title: approval.action.tool == "conduit.review" ? "Approve Once" : "Approve",
            action: #selector(approvePendingApproval(_:)),
            keyEquivalent: ""
        )
        approveItem.target = self
        approveItem.representedObject = approval.approvalId
        submenu.addItem(approveItem)

        let denyItem = NSMenuItem(title: "Deny", action: #selector(denyPendingApproval(_:)), keyEquivalent: "")
        denyItem.target = self
        denyItem.representedObject = approval.approvalId
        submenu.addItem(denyItem)

        submenu.addItem(NSMenuItem.separator())
        let detailsItem = NSMenuItem(title: "Open Details", action: #selector(openPreferredApprovalDetails(_:)), keyEquivalent: "")
        detailsItem.target = self
        detailsItem.representedObject = approval.approvalId
        submenu.addItem(detailsItem)

        let desktopDetailsItem = NSMenuItem(title: "Open Desktop Details", action: #selector(openDesktopApprovalDetails(_:)), keyEquivalent: "")
        desktopDetailsItem.target = self
        desktopDetailsItem.representedObject = approval.approvalId
        submenu.addItem(desktopDetailsItem)

        let browserDetailsItem = NSMenuItem(title: "Open Browser Details", action: #selector(openBrowserApprovalDetails(_:)), keyEquivalent: "")
        browserDetailsItem.target = self
        browserDetailsItem.representedObject = approval.approvalId
        submenu.addItem(browserDetailsItem)

        item.submenu = submenu
        return item
    }

    private func approvalMenuTitle(for approval: ApprovalSummary) -> String {
        let prefix = approval.action.tool == "conduit.review" ? "Request" : approval.action.tool
        return "\(prefix): \(approvalDisplayTitle(for: approval))"
    }

    private func controlAppStatusSummary() -> String {
        if controlApp.isRunning {
            return "running"
        }
        if controlAppExternalAvailable {
            return controlAppSupportsAgentHandshake ? "available" : "stale"
        }
        return controlApp.statusSummary
    }

    private func controlAppToggleTitle() -> String {
        if controlApp.isRunning {
            return "Stop Control App"
        }
        if controlAppExternalAvailable {
            return controlAppSupportsAgentHandshake ? "Control App Already Running" : "Control App Needs Restart"
        }
        return "Start Control App"
    }

    private func controlAppToggleEnabled() -> Bool {
        controlApp.isRunning || !controlAppExternalAvailable || !controlAppSupportsAgentHandshake
    }

    private func refreshControlAppHealth(completion: ((Bool) -> Void)? = nil) {
        guard let url = URL(string: "http://127.0.0.1:47831/api/status") else {
            completion?(false)
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.75
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            let available = (response as? HTTPURLResponse)?.statusCode == 200
            let supportsAgentHandshake = data.flatMap { try? JSONDecoder().decode(ControlStatusResponse.self, from: $0) }?.capabilities.agentHandshake == true
            DispatchQueue.main.async {
                guard let self else {
                    return
                }
                if self.controlAppExternalAvailable != available || self.controlAppSupportsAgentHandshake != supportsAgentHandshake {
                    self.controlAppExternalAvailable = available
                    self.controlAppSupportsAgentHandshake = supportsAgentHandshake
                    self.refreshMenu()
                }
                completion?(available)
            }
        }.resume()
    }

    private func refreshApprovalNotifications() {
        guard controlApp.isRunning || controlAppExternalAvailable, let url = URL(string: "http://127.0.0.1:47831/api/approvals") else {
            if pendingApprovalCount != 0 {
                pendingApprovalCount = 0
                refreshMenu()
            }
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.75
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            guard
                (response as? HTTPURLResponse)?.statusCode == 200,
                let approvals = data.flatMap({ try? JSONDecoder().decode(ApprovalsResponse.self, from: $0) })
            else {
                return
            }
            let pending = approvals.approvals.filter { approval in
                approval.status == "pending" && approval.executionStatus == nil
            }
            DispatchQueue.main.async {
                guard let self else {
                    return
                }
                let oldIds = self.pendingApprovals.map(\.approvalId)
                let newIds = pending.map(\.approvalId)
                self.pendingApprovals = pending
                self.pendingApprovalCount = pending.count
                for approval in pending where !self.notifiedApprovalIds.contains(approval.approvalId) {
                    self.notifiedApprovalIds.insert(approval.approvalId)
                    self.notifyApprovalRequired(approval)
                }
                if oldIds != newIds {
                    self.rebuildMenu()
                } else {
                    self.refreshMenu()
                }
            }
        }.resume()
    }

    private func refreshAgentListenerHealth() {
        guard agentListener.isRunning, let url = URL(string: "http://127.0.0.1:3333/health") else {
            if agentListenerNeedsAttention {
                agentListenerNeedsAttention = false
                refreshMenu()
            }
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.75
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            let health = data.flatMap { try? JSONDecoder().decode(AgentListenerHealthResponse.self, from: $0) }
            let exhausted = (response as? HTTPURLResponse)?.statusCode == 200 && health?.lastTransportError?.needsAttention == true
            DispatchQueue.main.async {
                guard let self else {
                    return
                }
                self.agentListenerNeedsAttention = exhausted
                if exhausted, let error = health?.lastTransportError {
                    self.notifyAgentSendFailure(error)
                }
                self.refreshMenu()
            }
        }.resume()
    }

    private func notifyAgentSendFailure(_ error: AgentTransportError) {
        let transportId = error.transportId ?? "unknown"
        if notifiedTransportIds.contains(transportId) {
            return
        }
        notifiedTransportIds.insert(transportId)
        let content = UNMutableNotificationContent()
        content.title = "Conduit send needs attention"
        content.body = "Agent message \(transportId) could not be sent after retries. Reload the ChatGPT tab or extension, then retry."
        content.sound = .default
        let request = UNNotificationRequest(identifier: "conduit-send-\(transportId)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    private func notifyApprovalRequired(_ approval: ApprovalSummary) {
        let content = UNMutableNotificationContent()
        content.title = approval.action.tool == "conduit.review" ? "Conduit review required" : "Conduit approval required"
        content.body = approval.action.reason ?? approval.policyReason ?? "A local action is waiting for approval."
        content.sound = .default
        content.userInfo = [
            "conduitAction": "openApprovals",
            "approvalId": approval.approvalId
        ]
        let request = UNNotificationRequest(identifier: "conduit-approval-\(approval.approvalId)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    private func requestNotificationAuthorization() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    @objc private func toggleControlApp() {
        if controlApp.isRunning {
            controlApp.stop()
        } else if controlAppExternalAvailable && !controlAppSupportsAgentHandshake {
            restartStaleControlApp()
        } else if controlAppExternalAvailable {
            openControlPanel()
        } else {
            startControlApp()
        }
        refreshMenu()
    }

    @objc private func openControlPanel() {
        openControlPanelURL(path: "")
    }

    private func openApprovals() {
        openControlPanelURL(path: "#approvals")
    }

    @objc private func openControlPanelApprovals() {
        openApprovals()
    }

    private func openDiagnostics() {
        openControlPanelURL(path: "#diagnostics")
    }

    private func openControlPanelURL(path: String) {
        if !controlApp.isRunning && !controlAppExternalAvailable {
            startControlApp()
        }
        if let url = URL(string: "http://127.0.0.1:47831\(path)") {
            NSWorkspace.shared.open(url)
        }
    }

    private func handleConduitURL(_ url: URL) {
        ensureControlAppReady { [weak self] ready in
            guard let self else {
                return
            }
            guard ready else {
                self.presentError("Could not open Conduit link.", AppError("The control app did not become available."))
                return
            }
            Task {
                do {
                    let result = try await self.submitConduitURL(url)
                    let approval = try await self.approvalForConduitURLExecution(result.execution)
                    await MainActor.run {
                        self.refreshApprovalNotifications()
                        if result.execution.status == "requires_review" {
                            self.presentConduitURLApproval(result.execution, approval: approval)
                        } else if let runId = result.execution.runId {
                            self.notifyConduitURLAccepted("Conduit link executed", body: "Run \(runId) is ready in Conduit.")
                        } else {
                            self.notifyConduitURLAccepted("Conduit link handled", body: result.execution.reason ?? "Conduit handled the request.")
                        }
                    }
                } catch {
                    await MainActor.run {
                        self.presentError("Could not open Conduit link.", error)
                    }
                }
            }
        }
    }

    private func approvalForConduitURLExecution(_ execution: ConduitURLExecution) async throws -> ApprovalSummary? {
        guard execution.status == "requires_review", let approvalId = execution.approvalId else {
            return nil
        }
        return try await fetchApproval(approvalId: approvalId)
    }

    private func fetchApproval(approvalId: String) async throws -> ApprovalSummary? {
        guard let url = URL(string: "http://127.0.0.1:47831/api/approvals") else {
            throw AppError("Invalid approvals URL.")
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 5
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw AppError(String(data: data, encoding: .utf8) ?? "Approval lookup failed.")
        }
        let approvals = try JSONDecoder().decode(ApprovalsResponse.self, from: data).approvals
        return approvals.first { $0.approvalId == approvalId }
    }

    private func presentConduitURLApproval(_ execution: ConduitURLExecution, approval fetchedApproval: ApprovalSummary?) {
        guard let approvalId = execution.approvalId else {
            notifyConduitURLAccepted("Conduit review required", body: execution.reason ?? "A local review is waiting in the Conduit menu.")
            return
        }
        let existing = pendingApprovals.first { $0.approvalId == approvalId }
        let approval = fetchedApproval ?? existing ?? ApprovalSummary(
            approvalId: approvalId,
            status: "pending",
            policyReason: execution.reason,
            executionStatus: nil,
            action: ApprovalActionSummary(
                tool: "conduit.review",
                reason: execution.reason ?? "Review untrusted Conduit request before execution.",
                args: nil
            )
        )
        if let index = pendingApprovals.firstIndex(where: { $0.approvalId == approval.approvalId }) {
            pendingApprovals[index] = approval
        } else {
            pendingApprovals.append(approval)
            pendingApprovalCount = pendingApprovals.count
        }
        rebuildMenu()
        presentApprovalPrompt(approval)
    }

    private func ensureControlAppReady(completion: @escaping (Bool) -> Void) {
        if controlAppExternalAvailable && controlAppSupportsAgentHandshake {
            completion(true)
            return
        }
        if !controlApp.isRunning && !controlAppExternalAvailable {
            startControlApp()
        } else if controlAppExternalAvailable && !controlAppSupportsAgentHandshake {
            restartStaleControlApp(completion: completion)
            return
        }
        waitForControlAppHealth(completion: completion)
    }

    private func submitConduitURL(_ conduitURL: URL) async throws -> ConduitURLResponse {
        guard let url = URL(string: "http://127.0.0.1:47831/api/url/open") else {
            throw AppError("Invalid control app URL.")
        }
        let payload: [String: Any] = [
            "url": conduitURL.absoluteString
        ]
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw AppError(String(data: data, encoding: .utf8) ?? "Conduit link request failed.")
        }
        return try JSONDecoder().decode(ConduitURLResponse.self, from: data)
    }

    private func notifyConduitURLAccepted(_ title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let request = UNNotificationRequest(identifier: "conduit-url-\(UUID().uuidString)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    @objc private func copyAgentHandshake() {
        if !controlApp.isRunning && !controlAppExternalAvailable {
            startControlApp()
        }
        if !agentListener.isRunning {
            startAgentListener()
        }
        if controlAppExternalAvailable && !controlAppSupportsAgentHandshake {
            restartStaleControlApp { [weak self] restarted in
                guard restarted else {
                    return
                }
                self?.copyAgentHandshake()
            }
            return
        }

        Task {
            do {
                let handshake = try await requestAgentHandshake()
                await MainActor.run {
                    let pasteboard = NSPasteboard.general
                    pasteboard.clearContents()
                    pasteboard.setString(handshake.handshake, forType: .string)
                    refreshControlAppHealth()
                }
            } catch {
                await MainActor.run {
                    presentError("Could not copy the agent handshake.", error)
                }
            }
        }
    }

    @objc private func toggleDaemon() {
        if daemon.isRunning {
            daemon.stop()
        } else {
            startDaemon()
        }
        refreshMenu()
    }

    @objc private func approvePendingApproval(_ sender: NSMenuItem) {
        guard let approvalId = sender.representedObject as? String else {
            return
        }
        resolvePendingApproval(approvalId: approvalId, decision: "approve", reason: "Approved from Conduit menu bar.")
    }

    @objc private func denyPendingApproval(_ sender: NSMenuItem) {
        guard let approvalId = sender.representedObject as? String else {
            return
        }
        resolvePendingApproval(approvalId: approvalId, decision: "deny", reason: "Denied from Conduit menu bar.")
    }

    private func resolvePendingApproval(approvalId: String, decision: String, reason: String) {
        ensureControlAppReady { [weak self] ready in
            guard let self else {
                return
            }
            guard ready else {
                self.presentError("Could not resolve approval.", AppError("The control app did not become available."))
                return
            }
            Task {
                do {
                    let response = try await self.submitApprovalDecision(approvalId: approvalId, decision: decision, reason: reason)
                    await MainActor.run {
                        self.pendingApprovals.removeAll { $0.approvalId == approvalId }
                        self.pendingApprovalCount = self.pendingApprovals.count
                        self.rebuildMenu()
                        let action = decision == "approve" ? "approved" : "denied"
                        self.notifyConduitURLAccepted("Conduit approval \(action)", body: response.statusMessage)
                    }
                } catch {
                    await MainActor.run {
                        self.presentError("Could not resolve approval.", error)
                    }
                }
            }
        }
    }

    private func presentApprovalPrompt(_ approval: ApprovalSummary) {
        let alert = NSAlert()
        alert.messageText = approvalDisplayTitle(for: approval)
        alert.informativeText = approvalDisplaySubtitle(for: approval)
        alert.accessoryView = approvalSummaryView(for: approval)
        alert.alertStyle = .warning
        alert.addButton(withTitle: approval.action.tool == "conduit.review" ? "Approve Once" : "Approve")
        alert.addButton(withTitle: "Deny")
        alert.addButton(withTitle: "Details")
        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            resolvePendingApproval(approvalId: approval.approvalId, decision: "approve", reason: "Approved from Conduit notification.")
        } else if response == .alertSecondButtonReturn {
            resolvePendingApproval(approvalId: approval.approvalId, decision: "deny", reason: "Denied from Conduit notification.")
        } else {
            openApprovalDetails(approval)
        }
    }

    @objc private func openPreferredApprovalDetails(_ sender: NSMenuItem) {
        guard let approval = approvalFromMenuItem(sender) else {
            openApprovals()
            return
        }
        openApprovalDetails(approval)
    }

    @objc private func openDesktopApprovalDetails(_ sender: NSMenuItem) {
        guard let approval = approvalFromMenuItem(sender) else {
            return
        }
        setApprovalDetailsPreference("desktop")
        presentApprovalDetails(approval)
    }

    @objc private func openBrowserApprovalDetails(_ sender: NSMenuItem) {
        setApprovalDetailsPreference("browser")
        openApprovals()
    }

    private func approvalFromMenuItem(_ sender: NSMenuItem) -> ApprovalSummary? {
        guard let approvalId = sender.representedObject as? String else {
            return nil
        }
        return pendingApprovals.first { $0.approvalId == approvalId }
    }

    private func openApprovalDetails(_ approval: ApprovalSummary) {
        if approvalDetailsPreference() == "browser" {
            openApprovals()
            return
        }
        presentApprovalDetails(approval)
    }

    private func presentApprovalDetails(_ approval: ApprovalSummary) {
        let alert = NSAlert()
        alert.messageText = approvalDisplayTitle(for: approval)
        alert.informativeText = approvalDisplaySubtitle(for: approval)
        alert.accessoryView = approvalDetailsView(for: approval)
        alert.alertStyle = .informational
        alert.addButton(withTitle: "Done")
        alert.addButton(withTitle: "Use Browser Details")
        alert.addButton(withTitle: "Use Desktop Details")
        let response = alert.runModal()
        if response == .alertSecondButtonReturn {
            setApprovalDetailsPreference("browser")
            openApprovals()
        } else if response == .alertThirdButtonReturn {
            setApprovalDetailsPreference("desktop")
        }
    }

    private func approvalDetailsPreference() -> String {
        let stored = UserDefaults.standard.string(forKey: detailPreferenceKey)
        return stored == "browser" ? "browser" : "desktop"
    }

    private func setApprovalDetailsPreference(_ preference: String) {
        UserDefaults.standard.set(preference, forKey: detailPreferenceKey)
    }

    private func approvalDisplayTitle(for approval: ApprovalSummary) -> String {
        if approval.action.tool == "conduit.review" {
            return "Review local Conduit request"
        }
        if let title = approval.action.args?.title, !title.isEmpty {
            return title
        }
        return humanToolName(approval.action.tool)
    }

    private func approvalDisplaySubtitle(for approval: ApprovalSummary) -> String {
        if let description = approval.action.args?.description, !description.isEmpty {
            return description
        }
        if let reason = approval.action.reason, !reason.isEmpty {
            return reason
        }
        if let policyReason = approval.policyReason, !policyReason.isEmpty {
            return policyReason
        }
        return "A local action is waiting for approval."
    }

    private func approvalSummaryView(for approval: ApprovalSummary) -> NSView {
        let stack = verticalStack(width: 420)
        addKeyValue("Source", value: approvalSourceSummary(approval), to: stack)
        addKeyValue("Actions", value: approvalActionsSummary(approval, limit: 3), to: stack)
        addKeyValue("Permissions", value: approvalPermissionsSummary(approval), to: stack)
        if approval.action.args?.sessionId == nil {
            addKeyValue("Trust", value: "No live trusted session. Approve once only.", to: stack)
        }
        return stack
    }

    private func approvalDetailsView(for approval: ApprovalSummary) -> NSView {
        let stack = verticalStack(width: 520)
        addKeyValue("Source", value: approvalSourceSummary(approval), to: stack)
        addKeyValue("Actions", value: approvalActionsSummary(approval, limit: 12), to: stack)
        addKeyValue("Permissions", value: approvalPermissionsSummary(approval), to: stack)
        addKeyValue("Policy", value: approval.policyReason ?? "No additional policy reason.", to: stack)
        addKeyValue("Decision Mode", value: approval.action.tool == "conduit.review" ? "One-request approval under read-only local policy." : "Action approval for the current run.", to: stack)
        addKeyValue("Details Preference", value: approvalDetailsPreference() == "browser" ? "Browser control panel" : "Native desktop dialog", to: stack)
        return stack
    }

    private func verticalStack(width: CGFloat) -> NSStackView {
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.widthAnchor.constraint(equalToConstant: width).isActive = true
        return stack
    }

    private func addKeyValue(_ key: String, value: String, to stack: NSStackView) {
        let label = NSTextField(labelWithString: key)
        label.font = NSFont.boldSystemFont(ofSize: 12)
        label.textColor = .secondaryLabelColor
        let valueLabel = NSTextField(wrappingLabelWithString: value)
        valueLabel.font = NSFont.systemFont(ofSize: 13)
        valueLabel.textColor = .labelColor
        valueLabel.maximumNumberOfLines = 5
        stack.addArrangedSubview(label)
        stack.addArrangedSubview(valueLabel)
    }

    private func approvalSourceSummary(_ approval: ApprovalSummary) -> String {
        guard let source = approval.action.args?.source else {
            return "Unknown local request source"
        }
        return [source.kind, source.publisher, source.domain, source.trust].compactMap { $0 }.joined(separator: " / ")
    }

    private func approvalActionsSummary(_ approval: ApprovalSummary, limit: Int) -> String {
        guard let actions = approval.action.args?.actions, !actions.isEmpty else {
            return humanToolName(approval.action.tool)
        }
        let visible = actions.prefix(limit).map { action in
            let reason = action.reason.map { " - \($0)" } ?? ""
            return "\(action.id): \(humanToolName(action.tool))\(reason)"
        }
        let overflow = actions.count > limit ? ["\(actions.count - limit) more action(s)"] : []
        return (Array(visible) + overflow).joined(separator: "\n")
    }

    private func approvalPermissionsSummary(_ approval: ApprovalSummary) -> String {
        if let capabilities = approval.action.args?.requestedCapabilities, !capabilities.isEmpty {
            return capabilities.joined(separator: ", ")
        }
        guard let permissions = approval.action.args?.permissions, !permissions.isEmpty else {
            return "None declared"
        }
        return permissions.map { permission in
            [permission.kind, permission.scope, permission.access].compactMap { $0 }.joined(separator: ": ")
        }.joined(separator: ", ")
    }

    private func humanToolName(_ tool: String) -> String {
        switch tool {
        case "conduit.extension.prepareAlphaInstall":
            return "prepare Conduit Bridge extension package"
        case "conduit.review":
            return "review Conduit request"
        case "file.read":
            return "read file"
        case "file.write":
            return "write file"
        case "file.patch":
            return "apply patch"
        case "shell.run":
            return "run shell command"
        case "git.status":
            return "check git status"
        case "git.diff":
            return "inspect git diff"
        default:
            return tool
        }
    }

    private func submitApprovalDecision(approvalId: String, decision: String, reason: String) async throws -> ApprovalDecisionResponse {
        guard let url = URL(string: "http://127.0.0.1:47831/api/approvals/\(approvalId)/\(decision)") else {
            throw AppError("Invalid approval URL.")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["reason": reason])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw AppError(String(data: data, encoding: .utf8) ?? "Approval request failed.")
        }
        return (try? JSONDecoder().decode(ApprovalDecisionResponse.self, from: data)) ?? ApprovalDecisionResponse()
    }

    @objc private func toggleAgentListener() {
        if agentListener.isRunning {
            agentListener.stop()
        } else {
            startAgentListener()
        }
        refreshMenu()
    }

    @objc private func checkForUpdatesFromMenu() {
        checkForUpdates(notifyWhenCurrent: true)
    }

    private func scheduleStartupUpdateCheck() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            self?.checkForUpdates(notifyWhenCurrent: false)
        }
    }

    private func checkForUpdates(notifyWhenCurrent: Bool) {
        Task {
            do {
                let result = try await updater.check()
                await MainActor.run {
                    if result.isUpdateAvailable || notifyWhenCurrent {
                        presentUpdateResult(result)
                    }
                }
            } catch {
                await MainActor.run {
                    if notifyWhenCurrent {
                        if isMissingPinnedReleaseKeyError(error) {
                            presentUpdateResult(UpdateCheckResult.localPreviewMissingPinnedKey())
                        } else {
                            presentError("Could not check for updates.", error)
                        }
                    }
                }
            }
        }
    }

    private func isMissingPinnedReleaseKeyError(_ error: Error) -> Bool {
        error.localizedDescription.contains("does not include a pinned O&K release public key")
    }

    @objc private func openLogs() {
        NSWorkspace.shared.open(LogFiles.logDirectory)
    }

    @objc private func reportBug() {
        openDiagnostics()
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    private func startControlApp() {
        do {
            try controlApp.start(arguments: ["run", "conduit", "--", "app", "start", "--port", "47831"])
        } catch {
            presentError("Could not start the control app.", error)
        }
        refreshMenu()
    }

    private func restartStaleControlApp(completion: ((Bool) -> Void)? = nil) {
        do {
            let pids = try PortListeners.listenerPids(on: 47831)
            if pids.isEmpty {
                controlAppExternalAvailable = false
                controlAppSupportsAgentHandshake = false
                startControlApp()
                waitForControlAppHealth(completion: completion)
                return
            }
            let unexpectedPids = pids.filter { !PortListeners.isConduitControlListener(pid: $0, repoRoot: RepoLocator.repoRoot()) }
            if !unexpectedPids.isEmpty {
                throw AppError("Port 47831 is in use by a non-Conduit process: \(unexpectedPids.map { String($0) }.joined(separator: ", ")).")
            }

            for pid in pids {
                ProcessTree.terminateTree(of: pid)
            }
            refreshMenu()
            waitForPortToClear(47831) {
                self.controlAppExternalAvailable = false
                self.controlAppSupportsAgentHandshake = false
                self.startControlApp()
                self.waitForControlAppHealth(completion: completion)
            }
        } catch {
            presentError("Could not restart the control app.", error)
            completion?(false)
        }
    }

    private func waitForPortToClear(_ port: Int, completion: @escaping () -> Void) {
        DispatchQueue.global(qos: .utility).async {
            for _ in 0..<30 {
                if (try? PortListeners.listenerPids(on: port).isEmpty) == true {
                    break
                }
                Thread.sleep(forTimeInterval: 0.1)
            }
            DispatchQueue.main.async(execute: completion)
        }
    }

    private func waitForControlAppHealth(attemptsRemaining: Int = 30, completion: ((Bool) -> Void)?) {
        refreshControlAppHealth { [weak self] available in
            guard let self else {
                completion?(false)
                return
            }
            if available && self.controlAppSupportsAgentHandshake {
                completion?(true)
                return
            }
            guard attemptsRemaining > 0 else {
                completion?(false)
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                self.waitForControlAppHealth(attemptsRemaining: attemptsRemaining - 1, completion: completion)
            }
        }
    }

    private func startDaemon() {
        do {
            try daemon.start(arguments: ["run", "conduit", "--", "daemon", "start", "--interval-ms", "1000"])
        } catch {
            presentError("Could not start the clipboard daemon.", error)
        }
        refreshMenu()
    }

    private func startAgentListener() {
        do {
            let pids = try PortListeners.listenerPids(on: 3333)
            let unexpectedPids = pids.filter { !PortListeners.isConduitAgentListener(pid: $0, repoRoot: RepoLocator.repoRoot()) }
            if !unexpectedPids.isEmpty {
                throw AppError("Port 3333 is in use by a non-Conduit process: \(unexpectedPids.map { String($0) }.joined(separator: ", ")).")
            }
            for pid in pids {
                ProcessTree.terminateTree(of: pid)
            }
            waitForPortToClear(3333) {
                do {
                    try self.agentListener.start(arguments: ["run", "conduit", "--", "listen", "--project", RepoLocator.repoRoot()])
                } catch {
                    self.presentError("Could not start the agent listener.", error)
                }
                self.refreshMenu()
            }
        } catch {
            presentError("Could not start the agent listener.", error)
        }
        refreshMenu()
    }

    private func requestAgentHandshake() async throws -> AgentHandshakeResponse {
        guard let url = URL(string: "http://127.0.0.1:47831/api/agent-handshake") else {
            throw AppError("Invalid control app URL.")
        }
        let payload: [String: Any] = [
            "label": "Chat agent loop",
            "root": RepoLocator.repoRoot(),
            "profile": "read-only",
            "transport": "extension",
            "copy": false
        ]
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 5
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 201 else {
            throw AppError(String(data: data, encoding: .utf8) ?? "Handshake request failed.")
        }
        return try JSONDecoder().decode(AgentHandshakeResponse.self, from: data)
    }

    private func confirmTermination() -> Bool {
        let alert = NSAlert()
        alert.messageText = "Quit Conduit?"
        alert.informativeText = "Quitting stops the control app, agent listener, and clipboard daemon processes started by Conduit. Choose Keep Running if you want Conduit to stay in the menu bar supervising local execution."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Quit and Stop Services")
        alert.addButton(withTitle: "Keep Running")
        let shouldQuit = alert.runModal() == .alertFirstButtonReturn
        terminationConfirmed = shouldQuit
        return shouldQuit
    }

    private func presentUpdateResult(_ result: UpdateCheckResult) {
        let alert = NSAlert()
        alert.messageText = result.isUpdateAvailable ? "Conduit update available" : "Conduit is up to date"
        alert.informativeText = result.message
        if result.isUpdateAvailable, result.artifact != nil {
            alert.addButton(withTitle: "Install Update")
            alert.addButton(withTitle: "Later")
            if alert.runModal() == .alertFirstButtonReturn {
                installUpdate(result)
            }
        } else {
            alert.addButton(withTitle: "OK")
            alert.runModal()
        }
    }

    private func installUpdate(_ result: UpdateCheckResult) {
        Task {
            do {
                try await updater.install(result: result)
                await MainActor.run {
                    self.terminationConfirmed = true
                    NSApp.terminate(nil)
                }
            } catch {
                await MainActor.run {
                    presentError("Could not install the update.", error)
                }
            }
        }
    }

    private func presentError(_ title: String, _ error: Error) {
        let alert = NSAlert(error: error)
        alert.messageText = title
        alert.informativeText = [
            error.localizedDescription,
            "",
            "You can open the bug-report view to preview a redacted diagnostic bundle."
        ].joined(separator: "\n")
        alert.addButton(withTitle: "Report Bug")
        alert.addButton(withTitle: "OK")
        if alert.runModal() == .alertFirstButtonReturn {
            openDiagnostics()
        }
    }
}

extension AppDelegate: UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if response.notification.request.content.userInfo["conduitAction"] as? String == "openApprovals" {
            DispatchQueue.main.async {
                if let approvalId = response.notification.request.content.userInfo["approvalId"] as? String,
                   let approval = self.pendingApprovals.first(where: { $0.approvalId == approvalId }) {
                    self.presentApprovalPrompt(approval)
                } else {
                    self.openApprovals()
                }
            }
        }
        completionHandler()
    }
}

struct AgentHandshakeResponse: Decodable {
    let handshake: String
}

struct ApprovalsResponse: Decodable {
    let approvals: [ApprovalSummary]
}

struct ApprovalSummary: Decodable {
    let approvalId: String
    let status: String
    let policyReason: String?
    let executionStatus: String?
    let action: ApprovalActionSummary
}

struct ApprovalActionSummary: Decodable {
    let tool: String
    let reason: String?
    let args: ApprovalActionArgs?
}

struct ApprovalActionArgs: Decodable {
    let source: ApprovalSource?
    let title: String?
    let description: String?
    let permissions: [ApprovalPermission]
    let requestedCapabilities: [String]?
    let actions: [ApprovalRequestedAction]
    let sessionId: String?

    enum CodingKeys: String, CodingKey {
        case source
        case title
        case description
        case permissions
        case requestedCapabilities
        case actions
        case sessionId
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        source = try? container.decode(ApprovalSource.self, forKey: .source)
        title = try? container.decode(String.self, forKey: .title)
        description = try? container.decode(String.self, forKey: .description)
        permissions = (try? container.decode([ApprovalPermission].self, forKey: .permissions)) ?? []
        requestedCapabilities = try? container.decode([String].self, forKey: .requestedCapabilities)
        actions = (try? container.decode([ApprovalRequestedAction].self, forKey: .actions)) ?? []
        sessionId = try? container.decode(String.self, forKey: .sessionId)
    }
}

struct ApprovalSource: Decodable {
    let kind: String?
    let trust: String?
    let publisher: String?
    let domain: String?
}

struct ApprovalPermission: Decodable {
    let kind: String?
    let scope: String?
    let access: String?
}

struct ApprovalRequestedAction: Decodable {
    let id: String
    let tool: String
    let reason: String?
}

struct ApprovalDecisionResponse: Decodable {
    let execution: ApprovalExecutionSummary?
    let copiedToClipboard: Bool?

    init(execution: ApprovalExecutionSummary? = nil, copiedToClipboard: Bool? = nil) {
        self.execution = execution
        self.copiedToClipboard = copiedToClipboard
    }

    var statusMessage: String {
        if let runId = execution?.runId, copiedToClipboard == true {
            return "Run \(runId) completed and the result was copied to the clipboard."
        }
        if let runId = execution?.runId {
            return "Run \(runId) completed."
        }
        return "The approval decision was recorded."
    }
}

struct ApprovalExecutionSummary: Decodable {
    let runId: String?
}

struct ControlStatusResponse: Decodable {
    let capabilities: ControlCapabilities
}

struct ControlCapabilities: Decodable {
    let agentHandshake: Bool?
    let conduitUrlOpen: Bool?
}

struct ConduitURLResponse: Decodable {
    let command: String
    let execution: ConduitURLExecution
}

struct ConduitURLExecution: Decodable {
    let status: String
    let runId: String?
    let approvalId: String?
    let reason: String?
}

struct AgentListenerHealthResponse: Decodable {
    let lastTransportError: AgentTransportError?
}

struct AgentTransportError: Decodable {
    let transportId: String?
    let needsAttention: Bool?
}

struct AppError: LocalizedError {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var errorDescription: String? {
        message
    }
}

final class ManagedProcess {
    let label: String
    let logName: String
    private(set) var process: Process?
    private var logHandle: FileHandle?
    private let onExit: () -> Void
    private var lastExitSummary: String?

    init(label: String, logName: String, onExit: @escaping () -> Void) {
        self.label = label
        self.logName = logName
        self.onExit = onExit
    }

    var isRunning: Bool {
        process?.isRunning == true
    }

    var statusSummary: String {
        if isRunning {
            return "running"
        }
        return lastExitSummary ?? "stopped"
    }

    func start(arguments: [String]) throws {
        if isRunning {
            return
        }

        let launched = Process()
        let repoRoot = RepoLocator.repoRoot()
        let shellCommand = ShellCommand.npm(arguments: arguments, in: repoRoot)
        launched.executableURL = URL(fileURLWithPath: "/bin/zsh")
        launched.arguments = ["-lc", shellCommand]
        launched.currentDirectoryURL = URL(fileURLWithPath: repoRoot)

        let handle = try LogFiles.openLogHandle(named: logName)
        logHandle = handle
        lastExitSummary = nil
        writeLogLine("Starting \(label): \(shellCommand)")
        launched.standardOutput = handle
        launched.standardError = handle

        launched.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self else {
                    return
                }
                let status = launched.terminationStatus
                self.lastExitSummary = status == 0 ? "stopped" : "exited \(status)"
                self.writeLogLine("Stopped \(self.label) with exit status \(status).")
                self.logHandle?.closeFile()
                self.logHandle = nil
                self.process = nil
                self.onExit()
            }
        }

        try launched.run()
        process = launched
    }

    func stop() {
        guard let process else {
            return
        }
        writeLogLine("Stop requested for \(label).")
        if process.isRunning {
            ProcessTree.terminateChildren(of: process.processIdentifier)
            process.terminate()
        } else {
            logHandle?.closeFile()
            logHandle = nil
            self.process = nil
            lastExitSummary = "stopped"
            onExit()
        }
    }

    private func writeLogLine(_ text: String) {
        guard let data = "[\(Date())] \(text)\n".data(using: .utf8) else {
            return
        }
        logHandle?.write(data)
    }
}

enum ProcessTree {
    static func terminateTree(of pid: Int32) {
        terminateChildren(of: pid)
        kill(pid, SIGTERM)
    }

    static func terminateChildren(of pid: Int32) {
        for child in childPids(of: pid) {
            terminateTree(of: child)
        }
    }

    private static func childPids(of pid: Int32) -> [Int32] {
        let pkill = Process()
        let output = Pipe()
        pkill.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        pkill.arguments = ["-P", String(pid)]
        pkill.standardOutput = output
        pkill.standardError = FileHandle.nullDevice
        do {
            try pkill.run()
        } catch {
            return []
        }
        pkill.waitUntilExit()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        let text = String(data: data, encoding: .utf8) ?? ""
        return text
            .split(whereSeparator: \.isWhitespace)
            .compactMap { Int32($0) }
    }
}

enum PortListeners {
    static func listenerPids(on port: Int) throws -> [Int32] {
        let lsof = Process()
        let output = Pipe()
        lsof.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        lsof.arguments = ["-nP", "-t", "-iTCP:\(port)", "-sTCP:LISTEN"]
        lsof.standardOutput = output
        lsof.standardError = FileHandle.nullDevice
        try lsof.run()
        lsof.waitUntilExit()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        let text = String(data: data, encoding: .utf8) ?? ""
        return text
            .split(whereSeparator: \.isWhitespace)
            .compactMap { Int32($0) }
    }

    static func isConduitControlListener(pid: Int32, repoRoot: String) -> Bool {
        let command = commandLine(for: pid)
        return command.contains("src/cli/index.ts app start")
            || command.contains("dist/cli/index.js app start")
            || (command.contains(repoRoot) && command.contains("app start --port 47831"))
    }

    static func isConduitAgentListener(pid: Int32, repoRoot: String) -> Bool {
        let command = commandLine(for: pid)
        return command.contains("src/cli/index.ts listen")
            || command.contains("dist/cli/index.js listen")
            || (command.contains(repoRoot) && command.contains("listen --project"))
    }

    private static func commandLine(for pid: Int32) -> String {
        let ps = Process()
        let output = Pipe()
        ps.executableURL = URL(fileURLWithPath: "/bin/ps")
        ps.arguments = ["-p", String(pid), "-o", "command="]
        ps.standardOutput = output
        ps.standardError = FileHandle.nullDevice
        do {
            try ps.run()
        } catch {
            return ""
        }
        ps.waitUntilExit()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8) ?? ""
    }
}

enum ShellCommand {
    static func npm(arguments: [String], in repoRoot: String) -> String {
        let command = (["npm"] + arguments).map(quote).joined(separator: " ")
        let pathExports = [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "\(NSHomeDirectory())/.nvm/current/bin"
        ].joined(separator: ":")
        return [
            "export PATH=\(quote(pathExports)):$PATH",
            "export CONDUIT_PARENT_PID=\(quote(String(ProcessInfo.processInfo.processIdentifier)))",
            "export NVM_DIR=\"$HOME/.nvm\"",
            "[ -s \"$NVM_DIR/nvm.sh\" ] && . \"$NVM_DIR/nvm.sh\"",
            "cd \(quote(repoRoot))",
            "exec \(command)"
        ].joined(separator: "; ")
    }

    private static func quote(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
    }
}

enum LogFiles {
    static let logDirectory = FileManager.default
        .urls(for: .libraryDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("Logs/Conduit", isDirectory: true)

    static func openLogHandle(named name: String) throws -> FileHandle {
        try FileManager.default.createDirectory(at: logDirectory, withIntermediateDirectories: true)
        let url = logDirectory.appendingPathComponent(name)
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        let handle = try FileHandle(forWritingTo: url)
        try handle.seekToEnd()
        return handle
    }
}

enum RepoLocator {
    static func repoRoot() -> String {
        if let configured = ProcessInfo.processInfo.environment["CONDUIT_REPO_ROOT"], !configured.isEmpty {
            return configured
        }

        let bundleCandidate = Bundle.main.bundleURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .path
        if FileManager.default.fileExists(atPath: "\(bundleCandidate)/package.json") {
            return bundleCandidate
        }

        return FileManager.default.currentDirectoryPath
    }
}

enum ConduitIcon {
    static func makeStatusImage() -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18))
        image.lockFocus()
        NSColor.black.setStroke()
        NSColor.black.setFill()

        let outer = NSBezierPath(ovalIn: NSRect(x: 2, y: 2, width: 14, height: 14))
        outer.lineWidth = 1.7
        outer.stroke()

        let path = NSBezierPath()
        path.move(to: NSPoint(x: 9, y: 4))
        path.line(to: NSPoint(x: 13, y: 9))
        path.line(to: NSPoint(x: 9, y: 14))
        path.line(to: NSPoint(x: 5, y: 9))
        path.close()
        path.fill()

        image.unlockFocus()
        image.isTemplate = true
        return image
    }
}

struct UpdateManifest: Decodable {
    let schema: String
    let appId: String?
    let publisherId: String?
    let publisherDomain: String?
    let version: String
    let channel: String
    let releaseNotes: String?
    let publishedAt: String?
    let artifacts: [UpdateArtifact]
}

struct UpdateArtifact: Decodable {
    let platform: String
    let url: String
    let sha256: String?
    let sizeBytes: Int?
    let signature: String?
}

struct UpdateCheckResult {
    let isUpdateAvailable: Bool
    let message: String
    let manifest: UpdateManifest
    let artifact: UpdateArtifact?
    let verifiedPublisher: String?

    static func localPreviewMissingPinnedKey() -> UpdateCheckResult {
        UpdateCheckResult(
            isUpdateAvailable: false,
            message: [
                "This local Conduit build cannot verify signed O&K release manifests because it was built without the pinned release public key.",
                "",
                "That is normal for a local preview/dev build. Updates remain disabled here instead of installing anything unverifiable. Use a signed release build, or rebuild with CONDUIT_OK_PUBLISHER_PUBLIC_KEY_PEM, to enable update checks."
            ].joined(separator: "\n"),
            manifest: UpdateManifest(
                schema: "conduit.update-manifest.v1",
                appId: "conduit",
                publisherId: "owl-kestrel",
                publisherDomain: "owlandkestrel.com",
                version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.1",
                channel: "local-preview",
                releaseNotes: nil,
                publishedAt: nil,
                artifacts: []
            ),
            artifact: nil,
            verifiedPublisher: nil
        )
    }
}

struct SignedManifestEnvelope: Decodable {
    let schema: String
    let publisher: SignedManifestPublisher
    let signedPayload: String
    let signature: SignedManifestSignature
}

struct SignedManifestPublisher: Decodable {
    let id: String
    let name: String
    let domain: String
    let keyId: String
}

struct SignedManifestSignature: Decodable {
    let alg: String
    let value: String
}

enum Base64URL {
    static func decode(_ text: String) throws -> Data {
        var normalized = text
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let padding = (4 - normalized.count % 4) % 4
        normalized.append(String(repeating: "=", count: padding))
        guard let data = Data(base64Encoded: normalized) else {
            throw AppError("Invalid base64url data in signed manifest.")
        }
        return data
    }
}

enum ShellEscaper {
    static func quote(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
    }
}

final class UpdateChecker {
    private var currentVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.1"
    }
    private var trustedPublisherID: String {
        Bundle.main.object(forInfoDictionaryKey: "ConduitOKPublisherID") as? String ?? "owl-kestrel"
    }
    private var trustedPublisherDomain: String {
        Bundle.main.object(forInfoDictionaryKey: "ConduitOKPublisherDomain") as? String ?? "owlandkestrel.com"
    }
    private var trustedPublisherKeyID: String {
        Bundle.main.object(forInfoDictionaryKey: "ConduitOKPublisherKeyID") as? String ?? "ok-release-p256-v1"
    }
    private var trustedPublisherPublicKeyPEM: String? {
        guard let pem = Bundle.main.object(forInfoDictionaryKey: "ConduitOKPublisherPublicKeyPEM") as? String,
              !pem.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return pem
    }

    func check() async throws -> UpdateCheckResult {
        let loaded = try await loadManifest()
        let manifest = loaded.manifest
        let artifact = manifest.artifacts.first { $0.platform == "macos-universal" || $0.platform == "macos-arm64" || $0.platform == "macos" }
        let updateAvailable = compareVersions(manifest.version, currentVersion) == .orderedDescending
        let signatureState = loaded.verifiedPublisher.map { "Verified publisher: \($0)." } ?? "Unsigned local preview manifest."
        let notes = manifest.releaseNotes ?? "No release notes."
        let message = updateAvailable
            ? "Version \(manifest.version) is available on \(manifest.channel). \(signatureState)\n\n\(notes)"
            : "Current version \(currentVersion) is at least as new as \(manifest.version). \(signatureState)"

        return UpdateCheckResult(
            isUpdateAvailable: updateAvailable,
            message: message,
            manifest: manifest,
            artifact: artifact,
            verifiedPublisher: loaded.verifiedPublisher
        )
    }

    func install(result: UpdateCheckResult) async throws {
        guard result.isUpdateAvailable else {
            throw AppError("No newer Conduit version is available.")
        }
        guard result.verifiedPublisher != nil else {
            throw AppError("Refusing to install an update from an unsigned manifest.")
        }
        guard let artifact = result.artifact, let downloadURL = URL(string: artifact.url) else {
            throw AppError("The update manifest does not include a usable macOS artifact URL.")
        }
        guard let expectedSha256 = artifact.sha256, expectedSha256.range(of: #"^[0-9a-fA-F]{64}$"#, options: .regularExpression) != nil else {
            throw AppError("The update artifact is missing a valid SHA-256 digest.")
        }

        let downloaded = try await downloadArtifact(from: downloadURL)
        let actualSha256 = try sha256Hex(of: downloaded)
        guard actualSha256.caseInsensitiveCompare(expectedSha256) == .orderedSame else {
            throw AppError("Downloaded update hash did not match the signed manifest.")
        }

        let helper = try writeInstallHelper(dmgURL: downloaded)
        try launchInstallHelper(helper)
    }

    private func loadManifest() async throws -> (manifest: UpdateManifest, verifiedPublisher: String?) {
        let manifestURL = resolvedManifestURL()
        if manifestURL.isFileURL {
            let data = try Data(contentsOf: manifestURL)
            return try decodeManifest(data)
        }

        let (data, _) = try await URLSession.shared.data(from: manifestURL)
        return try decodeManifest(data)
    }

    private func decodeManifest(_ data: Data) throws -> (manifest: UpdateManifest, verifiedPublisher: String?) {
        if let envelope = try? JSONDecoder().decode(SignedManifestEnvelope.self, from: data),
           envelope.schema == "ok.signed-manifest.v1" {
            return try verifySignedManifest(envelope)
        }
        return (try JSONDecoder().decode(UpdateManifest.self, from: data), nil)
    }

    private func verifySignedManifest(_ envelope: SignedManifestEnvelope) throws -> (manifest: UpdateManifest, verifiedPublisher: String?) {
        guard envelope.publisher.id == trustedPublisherID,
              envelope.publisher.domain == trustedPublisherDomain,
              envelope.publisher.keyId == trustedPublisherKeyID else {
            throw AppError("The update manifest publisher is not trusted by this Conduit build.")
        }
        guard envelope.signature.alg == "ECDSA_P256_SHA256_DER" else {
            throw AppError("Unsupported update manifest signature algorithm: \(envelope.signature.alg).")
        }
        guard let pem = trustedPublisherPublicKeyPEM else {
            throw AppError("This Conduit build does not include a pinned O&K release public key.")
        }
        let payload = try Base64URL.decode(envelope.signedPayload)
        let signatureData = try Base64URL.decode(envelope.signature.value)
        let publicKey = try P256.Signing.PublicKey(pemRepresentation: pem)
        let signature = try P256.Signing.ECDSASignature(derRepresentation: signatureData)
        guard publicKey.isValidSignature(signature, for: payload) else {
            throw AppError("The update manifest signature is invalid.")
        }
        let manifest = try JSONDecoder().decode(UpdateManifest.self, from: payload)
        guard manifest.appId == nil || manifest.appId == "conduit" else {
            throw AppError("The signed manifest is not for Conduit.")
        }
        guard manifest.publisherId == nil || manifest.publisherId == envelope.publisher.id else {
            throw AppError("The signed manifest publisher does not match the envelope.")
        }
        guard manifest.publisherDomain == nil || manifest.publisherDomain == envelope.publisher.domain else {
            throw AppError("The signed manifest publisher domain does not match the envelope.")
        }
        return (manifest, "\(envelope.publisher.name) (\(envelope.publisher.domain))")
    }

    private func resolvedManifestURL() -> URL {
        if let configured = ProcessInfo.processInfo.environment["CONDUIT_UPDATE_MANIFEST_URL"],
           let url = URL(string: configured) {
            return url
        }

        let localManifest = URL(fileURLWithPath: RepoLocator.repoRoot())
            .appendingPathComponent("dist/macos/conduit-appcast.json")
        if FileManager.default.fileExists(atPath: localManifest.path) {
            return localManifest
        }

        if let url = URL(string: "https://owlandkestrel.com/releases/conduit/appcast.json") {
            return url
        }

        let previewManifest = URL(fileURLWithPath: RepoLocator.repoRoot())
            .appendingPathComponent("website/releases/conduit-appcast.json")
        return previewManifest
    }

    private func downloadArtifact(from url: URL) async throws -> URL {
        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("Conduit-\(UUID().uuidString).dmg")
        if url.isFileURL {
            try FileManager.default.copyItem(at: url, to: destination)
            return destination
        }
        let (downloaded, response) = try await URLSession.shared.download(from: url)
        guard (response as? HTTPURLResponse)?.statusCode ?? 200 < 400 else {
            throw AppError("The update artifact could not be downloaded.")
        }
        try FileManager.default.moveItem(at: downloaded, to: destination)
        return destination
    }

    private func sha256Hex(of fileURL: URL) throws -> String {
        let data = try Data(contentsOf: fileURL)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func writeInstallHelper(dmgURL: URL) throws -> URL {
        let currentBundle = Bundle.main.bundleURL
        guard currentBundle.pathExtension == "app" else {
            throw AppError("Conduit is not running from an app bundle.")
        }
        let helperURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("conduit-update-\(UUID().uuidString).sh")
        let script = """
        #!/usr/bin/env bash
        set -euo pipefail
        DMG_PATH=\(ShellEscaper.quote(dmgURL.path))
        APP_PATH=\(ShellEscaper.quote(currentBundle.path))
        CURRENT_PID=\(getpid())
        LOG_DIR="$HOME/Library/Logs/Conduit"
        LOG_FILE="$LOG_DIR/update-helper.log"
        mkdir -p "$LOG_DIR"
        exec >>"$LOG_FILE" 2>&1
        echo "Starting Conduit update helper at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
        while /bin/kill -0 "$CURRENT_PID" >/dev/null 2>&1; do
          /bin/sleep 0.2
        done
        MOUNT_OUTPUT="$(/usr/bin/hdiutil attach "$DMG_PATH" -nobrowse -readonly)"
        MOUNT_POINT="$(printf '%s\\n' "$MOUNT_OUTPUT" | /usr/bin/awk '/\\/Volumes\\// { for (i=1; i<=NF; i++) if ($i ~ /^\\/Volumes\\//) { print $i; exit } }')"
        if [[ -z "$MOUNT_POINT" ]]; then
          echo "Could not determine mounted DMG path."
          exit 1
        fi
        trap '/usr/bin/hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || true' EXIT
        if [[ ! -d "$MOUNT_POINT/Conduit.app" ]]; then
          echo "Mounted DMG did not contain Conduit.app."
          exit 1
        fi
        BACKUP_PATH="${APP_PATH}.previous"
        /bin/rm -rf "$BACKUP_PATH"
        if [[ -d "$APP_PATH" ]]; then
          /bin/mv "$APP_PATH" "$BACKUP_PATH"
        fi
        /usr/bin/ditto "$MOUNT_POINT/Conduit.app" "$APP_PATH"
        /bin/rm -rf "$BACKUP_PATH"
        /usr/bin/open -n "$APP_PATH"
        echo "Conduit update complete."
        """
        try script.write(to: helperURL, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: helperURL.path)
        return helperURL
    }

    private func launchInstallHelper(_ helperURL: URL) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = [helperURL.path]
        try process.run()
    }

    private func compareVersions(_ lhs: String, _ rhs: String) -> ComparisonResult {
        let left = lhs.split(separator: ".").map { Int($0) ?? 0 }
        let right = rhs.split(separator: ".").map { Int($0) ?? 0 }
        let count = max(left.count, right.count)
        for index in 0..<count {
            let a = index < left.count ? left[index] : 0
            let b = index < right.count ? right[index] : 0
            if a > b { return .orderedDescending }
            if a < b { return .orderedAscending }
        }
        return .orderedSame
    }
}
