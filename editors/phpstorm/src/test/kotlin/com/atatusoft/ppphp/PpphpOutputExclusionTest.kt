package com.atatusoft.ppphp

import com.intellij.openapi.roots.impl.DirectoryIndexExcludePolicy
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.testFramework.LightVirtualFile
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.net.URI
import java.nio.file.FileSystems
import java.nio.file.Files
import java.nio.file.Path

class PpphpOutputExclusionTest : BasePlatformTestCase() {
    fun testConfiguredCompilerDirectoriesAreResolvedForExclusion() =
        withProjectDirectory { root ->
            writeConfiguration(root, validConfiguration())
            Files.createDirectories(root.resolve("build/ppphp"))
            Files.createDirectories(root.resolve(".ppphp-cache"))

            val canonicalRoot = root.toRealPath()
            val directories = requireNotNull(PpphpProjectConfiguration.load(root))

            assertEquals(canonicalRoot.resolve("build/ppphp"), directories.output)
            assertEquals(canonicalRoot.resolve(".ppphp-cache"), directories.cache)
        }

    fun testConfiguredCompilerDirectoriesUseTheProjectFilesystemProvider() =
        withZipProjectDirectory { root ->
            Files.createDirectories(root.resolve("src"))
            Files.createDirectories(root.resolve("stubs"))
            Files.createDirectories(root.resolve("build/ppphp"))
            Files.createDirectories(root.resolve(".ppphp-cache"))
            writeConfiguration(root, validConfiguration())

            val directories = requireNotNull(PpphpProjectConfiguration.load(root))

            assertSame(root.fileSystem.provider(), directories.output.fileSystem.provider())
            assertSame(root.fileSystem.provider(), directories.cache.fileSystem.provider())
            assertEquals(root.toRealPath().resolve("build/ppphp"), directories.output)
            assertEquals(root.toRealPath().resolve(".ppphp-cache"), directories.cache)

            val virtualRoot = NioBackedVirtualFile(root)
            val urls = PpphpProjectConfiguration.excludedUrls(virtualRoot)
            assertEquals(
                listOf(
                    virtualRoot.findFileByRelativePath("build/ppphp")?.url,
                    virtualRoot.findFileByRelativePath(".ppphp-cache")?.url,
                ),
                urls,
            )
        }

    fun testClosedFilesystemFailsClosed() {
        val archive = Files.createTempFile("ppphp-output-exclusion-", ".zip")
        Files.delete(archive)
        val root = FileSystems.newFileSystem(
            URI.create("jar:${archive.toUri()}"),
            mapOf("create" to "true"),
        ).use { fileSystem ->
            Files.createDirectories(fileSystem.getPath("/project"))
        }

        try {
            assertNull(PpphpProjectConfiguration.load(root))
        } finally {
            Files.deleteIfExists(archive)
        }
    }

    fun testUnsupportedProjectVirtualFilesystemFailsClosed() {
        val unsupportedRoot = LightVirtualFile("unsupported-project-root")

        assertNull(PpphpProjectConfiguration.configurationPath(unsupportedRoot))
        assertNull(PpphpProjectConfiguration.load(unsupportedRoot))
        assertEmpty(PpphpProjectConfiguration.excludedUrls(unsupportedRoot))
    }

    fun testExclusionUrlsPreserveTheProjectVirtualFilesystemIdentity() {
        withProjectDirectory { rootPath ->
            writeConfiguration(rootPath, validConfiguration())
            Files.createDirectories(rootPath.resolve("build/ppphp"))
            Files.createDirectories(rootPath.resolve(".ppphp-cache"))
            val root = requireNotNull(
                LocalFileSystem.getInstance().refreshAndFindFileByNioFile(rootPath),
            )
            root.refresh(false, true)
            val output = requireNotNull(root.findFileByRelativePath("build/ppphp"))
            val cache = requireNotNull(root.findFileByRelativePath(".ppphp-cache"))

            val urls = PpphpProjectConfiguration.excludedUrls(root)

            assertEquals(listOf(output.url, cache.url), urls)
            assertSame(output, VirtualFileManager.getInstance().findFileByUrl(urls[0]))
            assertSame(cache, VirtualFileManager.getInstance().findFileByUrl(urls[1]))
        }
    }

    fun testExclusionUrlsAreStableBeforeCompilerDirectoriesExist() {
        withProjectDirectory { rootPath ->
            writeConfiguration(rootPath, validConfiguration())
            val root = requireNotNull(
                LocalFileSystem.getInstance().refreshAndFindFileByNioFile(rootPath),
            )
            root.refresh(false, true)
            val policy = PpphpCompilerDirectoriesExcludePolicy(root)

            val first = policy.excludeUrlsForProject.toList()
            val second = policy.excludeUrlsForProject.toList()

            assertEquals(
                listOf("${root.url}/build/ppphp", "${root.url}/.ppphp-cache"),
                first,
            )
            assertEquals(first, second)
            assertNull(VirtualFileManager.getInstance().findFileByUrl(first[0]))
            assertNull(VirtualFileManager.getInstance().findFileByUrl(first[1]))
        }
    }

    fun testPolicyIsRegisteredWithPhpStorm() {
        val policies = DirectoryIndexExcludePolicy.EP_NAME.getPoint(project).extensionList

        assertEquals(
            1,
            policies.count { policy -> policy is PpphpCompilerDirectoriesExcludePolicy },
        )
    }

    fun testOutputThatOverlapsSourceIsNotExcluded() =
        withProjectDirectory { root ->
            writeConfiguration(root, validConfiguration(output = "src"))

            assertNull(PpphpProjectConfiguration.load(root))
        }

    fun testOutputThatOverlapsSymlinkedSourceTargetIsNotExcluded() =
        withProjectDirectory { root ->
            Files.createDirectories(root.resolve("real-src"))
            Files.createSymbolicLink(root.resolve("src-link"), Path.of("real-src"))
            writeConfiguration(root, validConfiguration(source = "src-link", output = "real-src"))

            assertNull(PpphpProjectConfiguration.load(root))
        }

    fun testOutputThatOverlapsSymlinkedStubTargetIsNotExcluded() =
        withProjectDirectory { root ->
            Files.createDirectories(root.resolve("real-stubs"))
            Files.createSymbolicLink(root.resolve("stubs-link"), Path.of("real-stubs"))
            writeConfiguration(
                root,
                validConfiguration(stubs = "stubs-link", output = "real-stubs"),
            )

            assertNull(PpphpProjectConfiguration.load(root))
        }

    fun testOutputOutsideProjectIsNotExcluded() =
        withProjectDirectory { root ->
            writeConfiguration(root, validConfiguration(output = "../generated"))

            assertNull(PpphpProjectConfiguration.load(root))
        }

    fun testProjectRootIsNotExcluded() =
        withProjectDirectory { root ->
            writeConfiguration(root, validConfiguration(output = "."))

            assertNull(PpphpProjectConfiguration.load(root))
        }

    fun testConfigurationFileRemainsProtected() =
        withProjectDirectory { root ->
            writeConfiguration(
                root,
                validConfiguration(output = "${PpphpProjectConfiguration.FILE_NAME}/generated"),
            )

            assertNull(PpphpProjectConfiguration.load(root))
        }

    fun testInvalidConfigurationIsNotExcluded() =
        withProjectDirectory { root ->
            writeConfiguration(root, "not json")

            assertNull(PpphpProjectConfiguration.load(root))
        }

    fun testOversizedConfigurationIsNotRead() =
        withProjectDirectory { root ->
            writeConfiguration(root, " ".repeat(1024 * 1024 + 1))

            assertNull(PpphpProjectConfiguration.load(root))
        }

    private fun withProjectDirectory(test: (Path) -> Unit) {
        val root = Files.createTempDirectory("ppphp-output-exclusion-")
        try {
            test(root)
        } finally {
            assertTrue(root.toFile().deleteRecursively())
        }
    }

    private fun withZipProjectDirectory(test: (Path) -> Unit) {
        val archive = Files.createTempFile("ppphp-output-exclusion-", ".zip")
        Files.delete(archive)
        try {
            FileSystems.newFileSystem(
                URI.create("jar:${archive.toUri()}"),
                mapOf("create" to "true"),
            ).use { fileSystem ->
                test(Files.createDirectories(fileSystem.getPath("/project")))
            }
        } finally {
            Files.deleteIfExists(archive)
        }
    }

    private class NioBackedVirtualFile(
        private val nioPath: Path,
        private val virtualParent: NioBackedVirtualFile? = null,
    ) : LightVirtualFile(nioPath.fileName?.toString() ?: "project") {
        override fun toNioPath(): Path = nioPath

        override fun isDirectory(): Boolean = Files.isDirectory(nioPath)

        override fun getParent(): VirtualFile? = virtualParent

        override fun getPath(): String =
            virtualParent?.let { parent -> "${parent.path}/$name" } ?: "/$name"

        override fun getChildren(): Array<VirtualFile> =
            if (!isDirectory) {
                EMPTY_ARRAY
            } else {
                Files.list(nioPath).use { children ->
                    val files = mutableListOf<VirtualFile>()
                    children.forEach { child -> files += NioBackedVirtualFile(child, this) }
                    files.toTypedArray()
                }
            }
    }

    private fun writeConfiguration(root: Path, contents: String) {
        Files.writeString(root.resolve(PpphpProjectConfiguration.FILE_NAME), contents)
    }

    private fun validConfiguration(
        source: String = "src",
        output: String = "build/ppphp",
        cache: String = ".ppphp-cache",
        stubs: String = "stubs",
    ): String =
        """
        {
          "source": ["$source"],
          "output": "$output",
          "cache": "$cache",
          "targetPhpVersion": "8.4",
          "stubs": ["$stubs"],
          "exclude": ["vendor", "build", ".ppphp-cache"]
        }
        """.trimIndent()
}
