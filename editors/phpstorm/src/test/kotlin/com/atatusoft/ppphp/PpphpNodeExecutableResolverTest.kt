package com.atatusoft.ppphp

import com.intellij.execution.ExecutionException
import junit.framework.TestCase
import org.junit.Assert.assertThrows
import java.nio.file.Files
import java.nio.file.Path

class PpphpNodeExecutableResolverTest : TestCase() {
    private lateinit var temporaryDirectory: Path

    override fun setUp() {
        super.setUp()
        temporaryDirectory = Files.createTempDirectory("ppphp-node-resolver-test")
    }

    override fun tearDown() {
        temporaryDirectory.toFile().deleteRecursively()
        super.tearDown()
    }

    fun testExplicitSystemPropertyTakesPrecedence() {
        val systemProperty = node("property-node")
        val environmentVariable = node("environment-node")
        val ideConfigured = node("ide-node")
        val pathExecutable = node("path-node")

        assertEquals(
            systemProperty,
            NodeExecutableResolver.resolve(
                systemProperty.toString(),
                environmentVariable.toString(),
                ideConfigured,
                pathExecutable,
            ),
        )
    }

    fun testIdeConfiguredNodeTakesPrecedenceOverPath() {
        val ideConfigured = node("ide-node")
        val pathExecutable = node("path-node")

        assertEquals(
            ideConfigured,
            NodeExecutableResolver.resolve(null, null, ideConfigured, pathExecutable),
        )
    }

    fun testPathIsUsedWhenIdeRuntimeIsNotLocalOrNoLongerExists() {
        val missingIdeExecutable = temporaryDirectory.resolve("missing-node")
        val pathExecutable = node("path-node")

        assertEquals(
            pathExecutable,
            NodeExecutableResolver.resolve(null, null, missingIdeExecutable, pathExecutable),
        )
    }

    fun testInvalidExplicitOverrideIsReportedInsteadOfSilentlyFallingBack() {
        val missingOverride = temporaryDirectory.resolve("missing-node")

        val exception = assertThrows(ExecutionException::class.java) {
            NodeExecutableResolver.resolve(
                missingOverride.toString(),
                null,
                node("ide-node"),
                node("path-node"),
            )
        }

        assertTrue(exception.message.orEmpty().contains(missingOverride.toString()))
    }

    fun testPosixPathRequiresExecutableFileAndPreservesDirectoryOrder() {
        if (com.intellij.openapi.util.SystemInfo.isWindows) return
        val first = Files.createDirectory(temporaryDirectory.resolve("first"))
        val second = Files.createDirectory(temporaryDirectory.resolve("second"))
        Files.createFile(first.resolve("node"))
        val executable = Files.createFile(second.resolve("node"))
        assertTrue(executable.toFile().setExecutable(true))
        assertEquals(executable, NodeExecutableResolver.findOnPath("$first:$second", false))
        assertTrue(first.resolve("node").toFile().setExecutable(true))
        assertEquals(first.resolve("node"), NodeExecutableResolver.findOnPath("$first:$second", false))
    }

    fun testWindowsPathFindsQuotedDirectoryAndExeWithoutPosixPermissions() {
        val directory = Files.createDirectory(temporaryDirectory.resolve("Node Runtime"))
        val executable = Files.createFile(directory.resolve("node.exe"))
        assertEquals(executable, NodeExecutableResolver.findOnPath(";\"$directory\";", true))
    }

    fun testMissingOrRelativePathNeverSearchesTheProjectDirectory() {
        assertNull(NodeExecutableResolver.findOnPath(null, false))
        assertNull(NodeExecutableResolver.findOnPath(":.:relative/path", false))
        assertNull(NodeExecutableResolver.findOnPath("relative/path\u0000", false))
        assertNull(NodeExecutableResolver.findOnPath(temporaryDirectory.toString(), false))
    }

    private fun node(name: String): Path = Files.createFile(temporaryDirectory.resolve(name))
}
