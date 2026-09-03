package com.atatusoft.ppphp

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.WriteAction
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.RootsChangeRescanningInfo
import com.intellij.openapi.roots.ex.ProjectRootManagerEx
import com.intellij.openapi.roots.impl.DirectoryIndexExcludePolicy
import com.intellij.openapi.startup.ProjectActivity
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.vfs.newvfs.BulkFileListener
import com.intellij.openapi.vfs.newvfs.events.VFileEvent

class PpphpCompilerDirectoriesExcludePolicy private constructor(
    private val exclusions: () -> List<String>,
) : DirectoryIndexExcludePolicy {
    constructor(project: Project) : this({ PpphpProjectConfiguration.excludedUrls(project) })

    internal constructor(projectRoot: VirtualFile) :
        this({ PpphpProjectConfiguration.excludedUrls(projectRoot) })

    override fun getExcludeUrlsForProject(): Array<String> =
        exclusions().toTypedArray()
}

class PpphpProjectActivity : ProjectActivity {
    override suspend fun execute(project: Project) {
        val configurationPath = PpphpProjectConfiguration.configurationPath(project) ?: return
        val projectRoot = configurationPath.parent
        val normalizedConfigurationPath = normalize(configurationPath.toString())
        val normalizedProjectRoot = normalize(projectRoot.toString())
        var knownExcludedUrls = PpphpProjectConfiguration.excludedUrls(project)

        project.messageBus.connect().subscribe(
            VirtualFileManager.VFS_CHANGES,
            object : BulkFileListener {
                override fun after(events: List<VFileEvent>) {
                    if (
                        events.none { event ->
                            canAffectConfiguration(
                                normalize(event.path),
                                normalizedConfigurationPath,
                                normalizedProjectRoot,
                            )
                        }
                    ) {
                        return
                    }

                    val currentExcludedUrls = PpphpProjectConfiguration.excludedUrls(project)
                    if (currentExcludedUrls == knownExcludedUrls) return
                    knownExcludedUrls = currentExcludedUrls
                    refreshProjectRoots(project)
                }
            },
        )
    }

    private fun canAffectConfiguration(
        eventPath: String,
        configurationPath: String,
        projectRoot: String,
    ): Boolean {
        if (eventPath == configurationPath) return true
        val projectPrefix = "$projectRoot/"
        if (!eventPath.startsWith(projectPrefix)) return false
        return !eventPath.removePrefix(projectPrefix).contains('/')
    }

    private fun refreshProjectRoots(project: Project) {
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) return@invokeLater
            WriteAction.run<RuntimeException> {
                ProjectRootManagerEx.getInstanceEx(project).makeRootsChange(
                    {},
                    RootsChangeRescanningInfo.TOTAL_RESCAN,
                )
            }
        }
    }

    private fun normalize(path: String): String = FileUtil.toSystemIndependentName(path)
}
