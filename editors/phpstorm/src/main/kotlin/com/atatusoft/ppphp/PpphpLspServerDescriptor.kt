package com.atatusoft.ppphp

import com.intellij.application.options.CodeStyle
import com.intellij.execution.ExecutionException
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.configurations.PathEnvironmentVariableUtil
import com.intellij.javascript.nodejs.interpreter.NodeJsInterpreterManager
import com.intellij.javascript.nodejs.interpreter.local.NodeJsLocalInterpreter
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.ProjectWideLspServerDescriptor
import com.intellij.platform.lsp.api.customization.LspCustomization
import com.jetbrains.php.lang.formatter.PhpCodeStyleSettings
import org.eclipse.lsp4j.ConfigurationItem
import java.nio.file.Files
import java.nio.file.Path

class PpphpLspServerDescriptor(project: Project, private val pluginRoot: Path) :
    ProjectWideLspServerDescriptor(project, "++PHP") {

    override val lspCustomization: LspCustomization = object : LspCustomization() {
        override val semanticTokensCustomizer = PpphpSemanticTokensSupport()
    }

    override fun isSupportedFile(file: VirtualFile): Boolean =
        file.extension.equals("ppphp", ignoreCase = true)

    override fun createCommandLine(): GeneralCommandLine {
        return PpphpLanguageServerRuntime.createCommandLine(
            project,
            pluginRoot,
            project.basePath,
            "--stdio",
        )
    }

    override fun getWorkspaceConfiguration(item: ConfigurationItem): Any? {
        if (item.section != "ppphp") return super.getWorkspaceConfiguration(item)

        val sorting = CodeStyle.getSettings(project)
            .getCustomSettings(PpphpCodeStyleSettings::class.java)
            .IMPORT_SORTING
        val protocolSorting = when (sorting) {
            PhpCodeStyleSettings.ImportSorting.ALPHABETIC -> "alphabetic"
            PhpCodeStyleSettings.ImportSorting.BY_LENGTH -> "length"
            PhpCodeStyleSettings.ImportSorting.DONT_SORT -> "none"
        }
        return mapOf(
            "completion" to mapOf("importSorting" to protocolSorting),
        )
    }
}

internal object PpphpLanguageServerRuntime {
    fun findPluginRoot(pluginClass: Class<*>): Path? =
        PathManager.getJarForClass(pluginClass)?.parent?.parent

    fun createCommandLine(
        project: Project,
        pluginRoot: Path,
        workingDirectory: String?,
        vararg arguments: String,
    ): GeneralCommandLine {
        val node = findNodeExecutable(project)
        val server = findBundledServer(pluginRoot)

        return GeneralCommandLine(node.toString(), server.toString(), *arguments).also { commandLine ->
            workingDirectory
                ?.let(Path::of)
                ?.takeIf(Files::isDirectory)
                ?.toFile()
                ?.let(commandLine::withWorkDirectory)
        }
    }

    private fun findBundledServer(pluginRoot: Path): Path {
        val server = pluginRoot.resolve("server/server.cjs")
        if (!Files.isRegularFile(server)) {
            throw ExecutionException("The bundled ++PHP language server is missing: $server")
        }
        return server
    }

    private fun findNodeExecutable(project: Project): Path =
        NodeExecutableResolver.resolve(
            System.getProperty("ppphp.language.server.node.path"),
            System.getenv("PPPHP_NODE_PATH"),
            findIdeNodeExecutable(project),
            PathEnvironmentVariableUtil.findExecutableInPathOnAnyOS("node")?.toPath(),
        )

    private fun findIdeNodeExecutable(project: Project): Path? {
        val interpreter = NodeJsInterpreterManager.getInstance(project).interpreter ?: return null
        val localInterpreter = NodeJsLocalInterpreter.tryCast(interpreter) ?: return null
        if (!localInterpreter.isValid) return null
        return Path.of(localInterpreter.interpreterSystemDependentPath)
    }
}

internal object NodeExecutableResolver {
    fun resolve(
        systemProperty: String?,
        environmentVariable: String?,
        ideConfigured: Path?,
        pathExecutable: Path?,
    ): Path {
        val explicitlyConfigured = sequenceOf(systemProperty, environmentVariable)
            .firstOrNull { !it.isNullOrBlank() }

        if (explicitlyConfigured != null) {
            val path = Path.of(explicitlyConfigured)
            if (Files.isRegularFile(path)) return path
            throw ExecutionException("The configured Node.js executable does not exist: $path")
        }

        return sequenceOf(ideConfigured, pathExecutable)
            .filterNotNull()
            .firstOrNull(Files::isRegularFile)
            ?: throw ExecutionException(
                "Could not find a Node.js executable for ++PHP tooling; Node.js 22 or newer is required. " +
                    "Configure a local Node.js runtime in PhpStorm, set PPPHP_NODE_PATH, " +
                    "or set -Dppphp.language.server.node.path=/absolute/path/to/node.",
            )
    }
}
