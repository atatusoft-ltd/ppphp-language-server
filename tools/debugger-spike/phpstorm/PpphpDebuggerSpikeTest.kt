package com.atatusoft.ppphp

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.newvfs.impl.VfsRootAccess
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import com.intellij.xdebugger.XDebugProcess
import com.intellij.xdebugger.XDebugProcessStarter
import com.intellij.xdebugger.XDebugSession
import com.intellij.xdebugger.XDebugSessionListener
import com.intellij.xdebugger.XDebuggerManager
import com.jetbrains.php.debug.common.PhpDebugProcess
import com.jetbrains.php.debug.common.PhpLineBreakpointType
import com.jetbrains.php.debug.common.PhpLocalDebugStrategy
import com.jetbrains.php.debug.xdebug.connection.XdebugConnection
import com.jetbrains.php.debug.xdebug.debugger.XdebugDriver
import java.net.InetAddress
import java.net.ServerSocket
import java.nio.file.Path
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/** Native PhpStorm debug session + native Xdebug driver + real PHP; opt-in only. */
class PpphpDebuggerSpikeTest : BasePlatformTestCase() {
    private fun pumpUntil(message: String, condition: () -> Boolean) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
        while (!condition() && System.nanoTime() < deadline) {
            UIUtil.dispatchAllInvocationEvents()
            Thread.sleep(10)
        }
        assertTrue(message, condition())
    }

    fun testNativePhpDebuggerAgainstMappedPpphpSource() {
        val root = requireNotNull(System.getenv("PPPHP_SPIKE_PROJECT"))
        val php = requireNotNull(System.getenv("PPPHP_SPIKE_PHP"))
        val extension = requireNotNull(System.getenv("PPPHP_SPIKE_XDEBUG"))
        val bridgePath = requireNotNull(System.getenv("PPPHP_SPIKE_BRIDGE"))
        VfsRootAccess.allowRootAccess(testRootDisposable, root)
        val file = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(Path.of(root, "src/Quote.ppphp"))!!
        myFixture.configureFromExistingVirtualFile(file)
        assertSame(PpphpFileType.INSTANCE, file.fileType)
        // This is a deliberate negative probe, not a workaround shipped to users.
        val nativeType = PhpLineBreakpointType.getInstance()
        val nativeGutter = nativeType.canPutAt(file, 8, project)
        println("OBSERVE native PHP gutter accepts independent ++PHP PSI: $nativeGutter")
        assertFalse(nativeGutter)
        val manager = XDebuggerManager.getInstance(project)
        val breakpoint = ApplicationManager.getApplication().runWriteAction<com.intellij.xdebugger.breakpoints.XLineBreakpoint<com.intellij.xdebugger.breakpoints.XBreakpointProperties<*>>> {
            manager.breakpointManager.addLineBreakpoint(nativeType, file.url, 8, null)
        }
        val server = ServerSocket(0, 1, InetAddress.getLoopbackAddress())
        server.soTimeout = 20000
        var session: XDebugSession? = null
        var bridge: Process? = null
        var runtime: Process? = null
        var connection: XdebugConnection? = null
        try {
            session = manager.startSessionAndShowTab("++PHP debugger spike", null, object : XDebugProcessStarter() {
                override fun start(debugSession: XDebugSession): XDebugProcess = PhpDebugProcess(
                    debugSession, XdebugDriver.INSTANCE,
                    PhpLocalDebugStrategy(project), null, false,
                )
            })
            val active = session
            var pauses = 0
            active.addSessionListener(object : XDebugSessionListener {
                override fun sessionPaused() { pauses++ }
            }, testRootDisposable)
            val debugProcess = active.debugProcess as PhpDebugProcess<*>
            bridge = ProcessBuilder(php, bridgePath, root, server.localPort.toString()).start()
            val ready = CompletableFuture.supplyAsync { bridge.inputStream.bufferedReader().readLine() }
                .get(10, TimeUnit.SECONDS)
            val port = Regex("\\\"port\\\":(\\d+)").find(ready)!!.groupValues[1]
            val accepted = CompletableFuture.supplyAsync {
                val socket = server.accept()
                XdebugConnection(socket.getInputStream(), socket.getOutputStream()).apply { init() }
            }
            runtime = ProcessBuilder(
                php, "-d", "zend_extension=$extension", "-d", "xdebug.mode=debug",
                "-d", "xdebug.start_with_request=yes", "-d", "xdebug.client_host=127.0.0.1",
                "-d", "xdebug.client_port=$port", "-d", "xdebug.log_level=0", "$root/build/main.php",
            ).start()
            pumpUntil("Runtime did not connect") { accepted.isDone }
            connection = accepted.get()
            @Suppress("UNCHECKED_CAST")
            (debugProcess as PhpDebugProcess<XdebugConnection>).connect(connection)
            val connected = connection
            ApplicationManager.getApplication().executeOnPooledThread { connected.connect() }
            fun at(name: String, line: Int) {
                pumpUntil("No suspended source position for $name:$line") { active.isSuspended && active.currentPosition != null }
                assertEquals("source file", name, active.currentPosition!!.file.name)
                assertEquals("source line", line, active.currentPosition!!.line + 1)
                println("PASS native PhpStorm -> $name:$line")
            }
            fun step(action: () -> Unit) {
                val previous = pauses
                action()
                pumpUntil("Step did not suspend") { pauses > previous && active.isSuspended && active.currentPosition != null }
            }
            pumpUntil("Initial session did not suspend") { active.isSuspended && active.currentPosition != null }
            if (active.currentPosition!!.file.name == "main.php") {
                println("OBSERVE PhpStorm initial entry stop: main.php:${active.currentPosition!!.line + 1}")
                step { active.resume() }
            }
            at("Quote.ppphp", 9)
            ApplicationManager.getApplication().runWriteAction { manager.breakpointManager.removeBreakpoint(breakpoint) }
            step { active.stepOver(false) }
            at("Quote.ppphp", 10)
            step { active.stepOver(false) }
            at("Quote.ppphp", 11)
            step { active.stepInto() }
            at("LegacyTax.php", 11)
            val value = CompletableFuture<String>()
            debugProcess.evalString("(string) \$subtotal", object : PhpDebugProcess.StringEvaluateCallback {
                override fun evaluated(result: String) { value.complete(result) }
                override fun errorOccurred() { value.completeExceptionally(AssertionError("Native value evaluation failed")) }
            })
            pumpUntil("Value evaluation did not return") { value.isDone }
            assertEquals("300", value.get())
            println("PASS native PhpStorm evaluation: subtotal=300")
            step { active.stepOver(false) }
            at("LegacyTax.php", 12)
            step { active.stepOut() }
            if (active.currentPosition!!.file.name == "LegacyTax.php") {
                val returnLine = active.currentPosition!!.line + 1
                assertTrue("Unexpected PHP return-value stop", returnLine in 12..13)
                println("OBSERVE PhpStorm return-value stop: LegacyTax.php:$returnLine")
                step { active.stepOut() }
            }
            at("Quote.ppphp", 12)
            var count = 0
            while (active.currentPosition!!.line + 1 != 17 && count++ < 30) {
                println("OBSERVE native when source stop: ${active.currentPosition!!.line + 1}")
                step { active.stepOver(false) }
            }
            at("Quote.ppphp", 17)
            val exception = CompletableFuture<String>()
            debugProcess.registerExceptionBreakpoint("RuntimeException", object : PhpDebugProcess.RegisterBreakpointCallback {
                override fun registered(id: String) { exception.complete(id) }
                override fun errorOccurred(errorMessage: String?) { exception.completeExceptionally(AssertionError(errorMessage)) }
            })
            pumpUntil("Exception breakpoint did not register") { exception.isDone }
            exception.get()
            step { active.resume() }
            at("Quote.ppphp", 19)
            active.resume()
            pumpUntil("Runtime did not exit") { !runtime.isAlive }
            assertEquals(0, runtime.exitValue())
            assertEquals("305\nQuantity must be positive\n", String(runtime.inputStream.readNBytes(4096), Charsets.UTF_8))
            println("PASS native PhpStorm exception and runtime output")
        } finally {
            if (bridge != null && !bridge.isAlive) println("BRIDGE: " + String(bridge.errorStream.readNBytes(4096), Charsets.UTF_8))
            if (runtime != null && !runtime.isAlive) println("RUNTIME: " + String(runtime.errorStream.readNBytes(4096), Charsets.UTF_8))
            session?.let {
                val descriptor = it.runContentDescriptor
                it.stop()
                if (!Disposer.isDisposed(descriptor)) Disposer.dispose(descriptor)
            }
            connection?.let { if (!Disposer.isDisposed(it)) Disposer.dispose(it) }
            UIUtil.dispatchAllInvocationEvents()
            runtime?.destroyForcibly()
            bridge?.destroyForcibly()
            server.close()
            ApplicationManager.getApplication().runWriteAction { manager.breakpointManager.removeBreakpoint(breakpoint) }
        }
    }
}
