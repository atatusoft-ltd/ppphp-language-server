package com.atatusoft.ppphp

import com.intellij.execution.ExecutionException
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.configurations.PathEnvironmentVariableUtil
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.ProjectWideLspClientDescriptor
import java.nio.file.Files
import java.nio.file.Path

class PpphpLspClientDescriptor(project: Project) :
    ProjectWideLspClientDescriptor(project, "++PHP") {

    override fun isSupportedFile(file: VirtualFile): Boolean =
        file.extension.equals("ppp", ignoreCase = true)

    override fun createCommandLine(): GeneralCommandLine {
        val node = findNodeExecutable()
        val server = PpphpPluginPaths.root().resolve("server/server.cjs")
        if (!Files.isRegularFile(server)) {
            throw ExecutionException("The bundled ++PHP language server is missing: $server")
        }

        return GeneralCommandLine(node.toString(), server.toString(), "--stdio")
            .withWorkDirectory(project.basePath)
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
