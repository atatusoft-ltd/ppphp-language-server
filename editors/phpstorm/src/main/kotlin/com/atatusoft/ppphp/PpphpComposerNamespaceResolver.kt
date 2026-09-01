package com.atatusoft.ppphp

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.execution.process.CapturingProcessHandler
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

/** Thin process bridge to the editor-neutral Composer namespace resolver. */
internal object PpphpComposerNamespaceResolver {
    fun resolve(project: Project, directory: VirtualFile): Resolution {
        val pluginRoot = PpphpLanguageServerRuntime.findPluginRoot(javaClass)
            ?: return Resolution.NONE
        val command = PpphpLanguageServerRuntime.createCommandLine(
            pluginRoot,
            project.basePath,
            "--infer-composer-namespace",
            directory.url,
        )
        val output = try {
            CapturingProcessHandler(command).runProcess(REQUEST_TIMEOUT_MILLISECONDS, true)
        } catch (_: Exception) {
            return Resolution.NONE
        }

        if (
            output.isTimeout || output.exitCode != 0 ||
            output.stdout.length + output.stderr.length > MAXIMUM_OUTPUT_CHARACTERS
        ) {
            return Resolution.NONE
        }

        val response = runCatching { JsonParser.parseString(output.stdout).asJsonObject }.getOrNull()
            ?: return Resolution.NONE
        return decode(response)
    }

    internal fun decode(response: JsonObject): Resolution {
        val authoritative = response.get("authoritative")
            ?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean }
            ?.asBoolean
            ?: return Resolution.NONE
        val namespaceValue = response.get("namespace") ?: return Resolution.NONE
        val namespace = when {
            namespaceValue.isJsonNull -> null
            namespaceValue.isJsonPrimitive && namespaceValue.asJsonPrimitive.isString ->
                namespaceValue.asString

            else -> return Resolution.NONE
        }

        return Resolution(namespace, authoritative)
    }

    internal data class Resolution(
        val namespace: String?,
        val authoritative: Boolean,
    ) {
        companion object {
            val NONE = Resolution(namespace = null, authoritative = false)
        }
    }

    private const val REQUEST_TIMEOUT_MILLISECONDS = 3_000
    private const val MAXIMUM_OUTPUT_CHARACTERS = 65_536
}
