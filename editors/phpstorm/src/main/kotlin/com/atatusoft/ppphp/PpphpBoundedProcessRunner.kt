package com.atatusoft.ppphp

import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.OSProcessHandler
import com.intellij.execution.process.ProcessEvent
import com.intellij.execution.process.ProcessListener
import com.intellij.execution.process.ProcessOutputTypes
import com.intellij.openapi.util.Key

internal data class PpphpProcessOutput(
    val stdout: String,
    val stderr: String,
    val exitCode: Int?,
)

internal object PpphpBoundedProcessRunner {
    fun run(
        command: GeneralCommandLine,
        timeoutMilliseconds: Int,
        maximumOutputCharacters: Int,
    ): PpphpProcessOutput? = runCatching {
        val handler = OSProcessHandler(command)
        val output = PpphpBoundedProcessOutput(maximumOutputCharacters) {
            handler.destroyProcess()
        }
        handler.addProcessListener(output)
        handler.startNotify()
        if (!handler.waitFor(timeoutMilliseconds.toLong())) {
            handler.destroyProcess()
            return@runCatching null
        }
        if (output.limitExceeded) return@runCatching null
        PpphpProcessOutput(output.stdout, output.stderr, handler.exitCode)
    }.getOrNull()
}

internal class PpphpBoundedProcessOutput(
    private val maximumCharacters: Int,
    private val terminate: () -> Unit,
) : ProcessListener {
    private val standardOutput = StringBuilder()
    private val standardError = StringBuilder()

    @Volatile
    var limitExceeded = false
        private set

    val stdout: String
        get() = synchronized(this) { standardOutput.toString() }

    val stderr: String
        get() = synchronized(this) { standardError.toString() }

    override fun onTextAvailable(event: ProcessEvent, outputType: Key<*>) {
        append(event.text, outputType)
    }

    internal fun append(text: String, outputType: Key<*>) {
        val exceeded = synchronized(this) {
            if (limitExceeded) return@synchronized false
            if (standardOutput.length + standardError.length + text.length > maximumCharacters) {
                limitExceeded = true
                true
            } else {
                when (outputType) {
                    ProcessOutputTypes.STDOUT -> standardOutput.append(text)
                    ProcessOutputTypes.STDERR -> standardError.append(text)
                }
                false
            }
        }
        if (exceeded) terminate()
    }
}
