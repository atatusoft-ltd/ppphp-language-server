package com.atatusoft.ppphp

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.WriteAction
import com.intellij.openapi.project.RootsChangeRescanningInfo
import com.intellij.openapi.roots.AdditionalLibraryRootsProvider
import com.intellij.openapi.roots.ProjectFileIndex
import com.intellij.openapi.roots.ex.ProjectRootManagerEx
import com.intellij.openapi.roots.impl.DirectoryIndexExcludePolicy
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.io.NioFiles
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.testFramework.IndexingTestUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.fixtures.TempDirTestFixture
import com.intellij.testFramework.fixtures.impl.TempDirTestFixtureImpl
import com.jetbrains.php.PhpIndex
import java.nio.file.Files
import java.nio.file.Path

class PpphpGeneratedPhpLibraryProviderTest : BasePlatformTestCase() {
    override fun createTempDirTestFixture(): TempDirTestFixture = TempDirTestFixtureImpl()

    fun testOnlyCompiledPpphpOutputsAreExposedToPhpIndexing() {
        val compiled = myFixture.tempDirFixture.createFile(
            "build/Application/DemoRunner.php",
            "<?php namespace Atatusoft\\Showcase\\Application; final class DemoRunner {}",
        )
        val copied = myFixture.tempDirFixture.createFile(
            "build/Application/LegacyGateway.php",
            "<?php namespace Atatusoft\\Showcase\\Infrastructure; final class LegacyGateway {}",
        )
        val manifest = myFixture.tempDirFixture.createFile(
            "build/.ppphp/manifest.json",
            manifest(
                compiled("app/Application/DemoRunner.ppphp", "Application/DemoRunner.php"),
                copied("app/Infrastructure/LegacyGateway.php", "Application/LegacyGateway.php"),
            ),
        )
        val output = requireNotNull(compiled.parent.parent)

        val library = requireNotNull(PpphpGeneratedPhpLibrary.resolve(output))

        assertTrue(library.contains(compiled))
        assertTrue(library.contains(compiled.parent))
        assertFalse(library.contains(copied))
        assertFalse(library.contains(manifest))
    }

    fun testCompiledOutputsAreVisibleToNativePhpReferencesWithoutCopiedDuplicates() {
        myFixture.tempDirFixture.createFile("ppphp.json", configuration())
        myFixture.tempDirFixture.createFile(
            "app/Infrastructure/LegacyGateway.php",
            "<?php namespace Atatusoft\\Showcase\\Infrastructure; final class LegacyGateway {}",
        )
        myFixture.tempDirFixture.createFile(
            "app/demo.php",
            "<?php use Atatusoft\\Showcase\\Application\\DemoRunner; DemoRunner::create();",
        )
        val compiled = myFixture.tempDirFixture.createFile(
            "build/Application/DemoRunner.php",
            "<?php namespace Atatusoft\\Showcase\\Application; final class DemoRunner { public static function create(): self { return new self(); } }",
        )
        val copied = myFixture.tempDirFixture.createFile(
            "build/Application/LegacyGateway.php",
            "<?php namespace Atatusoft\\Showcase\\Infrastructure; final class LegacyGateway {}",
        )
        myFixture.tempDirFixture.createFile(
            "build/.ppphp/manifest.json",
            manifest(
                compiled("app/Application/DemoRunner.ppphp", "Application/DemoRunner.php"),
                copied("app/Infrastructure/LegacyGateway.php", "Application/LegacyGateway.php"),
            ),
        )
        val output = requireNotNull(compiled.parent.parent)
        val projectRoot = requireNotNull(output.parent)
        assertSame(output, PpphpProjectConfiguration.outputDirectory(projectRoot))
        assertTrue(requireNotNull(PpphpGeneratedPhpLibrary.resolve(output)).excludedUrls.contains(copied.url))
        AdditionalLibraryRootsProvider.EP_NAME.point.registerExtension(
            PpphpGeneratedPhpLibraryProvider(projectRoot),
            testRootDisposable,
        )
        DirectoryIndexExcludePolicy.EP_NAME.getPoint(project).registerExtension(
            PpphpCompilerDirectoriesExcludePolicy(projectRoot),
            testRootDisposable,
        )

        refreshProjectRoots()
        IndexingTestUtil.waitUntilIndexesAreReady(project)

        val fileIndex = ProjectFileIndex.getInstance(project)
        val excludedUrls = PpphpProjectConfiguration.excludedUrls(projectRoot)
        assertFalse(excludedUrls.contains(output.url))
        assertTrue(excludedUrls.contains(copied.url))
        assertFalse(fileIndex.isInContent(compiled))
        assertFalse(fileIndex.isInContent(copied))
        assertTrue(fileIndex.isInLibrarySource(compiled))
        assertFalse(fileIndex.isInLibrarySource(copied))

        val index = PhpIndex.getInstance(project)
        assertSize(1, index.getClassesByFQN("Atatusoft\\Showcase\\Application\\DemoRunner"))
        assertEmpty(index.getClassesByFQN("Atatusoft\\Showcase\\Infrastructure\\LegacyGateway"))
    }

    fun testUnsupportedOrUnsafeManifestsFailClosed() {
        val output = myFixture.tempDirFixture.findOrCreateDir("build")
        val manifest = myFixture.tempDirFixture.createFile(
            "build/.ppphp/manifest.json",
            manifest(compiled("app/Unsafe.ppphp", "../Unsafe.php")),
        )

        assertNull(PpphpGeneratedPhpLibrary.resolve(output))

        ApplicationManager.getApplication().runWriteAction {
            manifest.setBinaryContent("{".toByteArray())
        }
        assertNull(PpphpGeneratedPhpLibrary.resolve(output))

        ApplicationManager.getApplication().runWriteAction {
            manifest.setBinaryContent(
                manifest(compiled("app/Unsafe.ppphp", "Unsafe.php"))
                    .replace("\"formatVersion\": 2", "\"formatVersion\": 2.5")
                    .toByteArray(),
            )
        }
        assertNull(PpphpGeneratedPhpLibrary.resolve(output))

        ApplicationManager.getApplication().runWriteAction {
            manifest.setBinaryContent(
                manifest(compiled("app/Unsafe.ppphp", "Unsafe.php"), version = 99).toByteArray(),
            )
        }
        assertNull(PpphpGeneratedPhpLibrary.resolve(output))
    }

    fun testConfiguredOutputResolvesToGeneratedLibrary() {
        val projectPath = Files.createTempDirectory("ppphp-generated-library-project-")
        Disposer.register(testRootDisposable) { NioFiles.deleteQuietly(projectPath) }
        Files.createDirectories(projectPath.resolve("app"))
        write(projectPath, "ppphp.json", configuration())
        write(
            projectPath,
            "build/Application/DemoRunner.php",
            "<?php namespace Atatusoft\\Showcase\\Application; final class DemoRunner {}",
        )
        write(
            projectPath,
            "build/.ppphp/manifest.json",
            manifest(compiled("app/Application/DemoRunner.ppphp", "Application/DemoRunner.php")),
        )
        val projectRoot = requireNotNull(
            LocalFileSystem.getInstance().refreshAndFindFileByNioFile(projectPath),
        )

        val output = requireNotNull(PpphpProjectConfiguration.outputDirectory(projectRoot))
        val library = requireNotNull(PpphpGeneratedPhpLibrary.resolve(output))

        assertEquals("build", output.name)
        assertTrue(library.contains(requireNotNull(output.findFileByRelativePath("Application/DemoRunner.php"))))
        assertFalse(library.contains(requireNotNull(output.findFileByRelativePath(".ppphp/manifest.json"))))
    }

    fun testProviderIsRegisteredWithPhpStorm() {
        assertEquals(
            1,
            AdditionalLibraryRootsProvider.EP_NAME.extensionList.count { provider ->
                provider is PpphpGeneratedPhpLibraryProvider
            },
        )
    }

    private fun refreshProjectRoots() {
        WriteAction.run<RuntimeException> {
            ProjectRootManagerEx.getInstanceEx(project).makeRootsChange(
                {},
                RootsChangeRescanningInfo.TOTAL_RESCAN,
            )
        }
    }

    private fun write(root: Path, relativePath: String, content: String) {
        val path = root.resolve(relativePath)
        Files.createDirectories(path.parent)
        Files.writeString(path, content)
    }

    private fun configuration(): String =
        """
        {
          "source": ["app"],
          "output": "build",
          "cache": ".ppphp-cache",
          "targetPhpVersion": "8.4",
          "stubs": [],
          "exclude": ["vendor", "build", ".ppphp-cache"]
        }
        """.trimIndent()

    private fun manifest(vararg files: String, version: Int = 2): String =
        """
        {
          "formatVersion": $version,
          "files": [${files.joinToString(",")}]
        }
        """.trimIndent()

    private fun compiled(source: String, output: String): String =
        """{"source":"$source","output":"$output","sourceKind":"ppphp","operation":"compile"}"""

    private fun copied(source: String, output: String): String =
        """{"source":"$source","output":"$output","sourceKind":"php","operation":"copy"}"""
}
