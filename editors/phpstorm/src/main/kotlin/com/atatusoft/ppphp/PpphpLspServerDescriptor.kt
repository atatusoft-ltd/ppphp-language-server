package com.atatusoft.ppphp

import com.intellij.execution.ExecutionException
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.configurations.PathEnvironmentVariableUtil
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.ProjectWideLspServerDescriptor
import java.nio.file.Files
import java.nio.file.Path

class PpphpLspServerDescriptor(project: Project, private val pluginRoot: Path) :
    ProjectWideLspServerDescriptor(project, "++PHP") {

    override fun isSupportedFile(file: VirtualFile): Boolean =
        file.extension.equals("ppp", ignoreCase = true)

    override fun createCommandLine(): GeneralCommandLine {
        val node = findNodeExecutable()
        val server = findBundledServer()

        return GeneralCommandLine(node.toString(), server.toString(), "--stdio").also {
            project.basePath?.let(it::withWorkDirectory)
        }
    }

    private fun findBundledServer(): Path {
        val server = pluginRoot.resolve("server/server.cjs")
        if (!Files.isRegularFile(server)) {
            throw ExecutionException("The bundled ++PHP language server is missing: $server")
        }
        return server
    }

    private fun findNodeExecutable(): Path {
        val configured = sequenceOf(
            System.getProperty("ppphp.language.server.node.path"),
            System.getenv("PPPHP_NODE_PATH"),
        ).firstOrNull { !it.isNullOrBlank() }

        if (configured != null) {
            val path = Path.of(configured)
            if (Files.isRegularFile(path)) return path
            throw ExecutionException("The configured Node.js executable does not exist: $path")
        }

        return PathEnvironmentVariableUtil.findInPath("node")?.toPath()
            ?: throw ExecutionException(
                "Node.js 22 or newer is required for ++PHP tooling. " +
                    "Set PPPHP_NODE_PATH or -Dppphp.language.server.node.path=/absolute/path/to/node.",
            )
    }
}
