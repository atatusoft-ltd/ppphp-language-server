package com.atatusoft.ppphp

import com.intellij.openapi.roots.impl.DirectoryIndexExcludePolicy
import com.intellij.testFramework.fixtures.BasePlatformTestCase
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
