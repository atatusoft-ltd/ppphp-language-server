package com.atatusoft.ppphp

import com.intellij.openapi.options.ConfigurationException
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.xmlb.XmlSerializer
import org.eclipse.lsp4j.ConfigurationItem
import java.nio.file.Files
import java.nio.file.Path
import javax.swing.JSpinner

class PpphpCompilerSettingsTest : BasePlatformTestCase() {
    override fun tearDown() {
        try {
            PpphpCompilerSettings.getInstance(project).loadState(PpphpCompilerSettings.Values())
        } finally {
            super.tearDown()
        }
    }

    fun testDefaultAndPersistedMemoryLimit() {
        val settings = PpphpCompilerSettings()
        assertEquals(512, settings.memoryLimitMegabytes)
        settings.loadState(PpphpCompilerSettings.Values().apply { memoryLimitMegabytes = 1024 })
        val xml = XmlSerializer.serialize(settings.state)
        val restored = PpphpCompilerSettings()
        restored.loadState(XmlSerializer.deserialize(xml, PpphpCompilerSettings.Values::class.java))
        assertEquals(1024, restored.memoryLimitMegabytes)
        for (invalid in listOf(0, -1)) {
            restored.loadState(PpphpCompilerSettings.Values().apply { memoryLimitMegabytes = invalid })
            assertEquals(512, restored.memoryLimitMegabytes)
        }
    }

    fun testSettingsApplyPublishesOnceAndUpdatesLspConfiguration() {
        var changes = 0
        project.messageBus.connect(testRootDisposable).subscribe(
            PpphpCompilerSettingsListener.TOPIC,
            object : PpphpCompilerSettingsListener {
                override fun settingsChanged() { changes++ }
            },
        )
        val configurable = PpphpCompilerConfigurable(project)
        try {
            configurable.createComponent()
            assertFalse(configurable.isModified)
            val spinner = requireNotNull(configurable.memoryLimit)
            (spinner.editor as JSpinner.DefaultEditor).textField.text = "768"
            assertTrue(configurable.isModified)
            configurable.apply()
            assertEquals(768, PpphpCompilerSettings.getInstance(project).memoryLimitMegabytes)
            assertFalse(configurable.isModified)
            configurable.apply()
            assertEquals(1, changes)

            val descriptor = PpphpLspServerDescriptor(project, Path.of("unused"))
            val configuration = descriptor.getWorkspaceConfiguration(ConfigurationItem().apply { section = "ppphp" }) as Map<*, *>
            assertEquals(768, (configuration["compiler"] as Map<*, *>)["memoryLimitMegabytes"])

            spinner.value = 1024
            configurable.reset()
            assertEquals(768, spinner.value)
            assertFalse(configurable.isModified)
            (spinner.editor as JSpinner.DefaultEditor).textField.text = "invalid"
            assertTrue(configurable.isModified)
            assertThrows(ConfigurationException::class.java) { configurable.apply() }
            assertEquals(768, PpphpCompilerSettings.getInstance(project).memoryLimitMegabytes)
            assertEquals(1, changes)
        } finally {
            configurable.disposeUIResources()
        }
    }

    fun testNativeHelpersReceiveTheProjectLimitWithoutChangingGlobalEnvironment() {
        val root = Files.createTempDirectory("ppphp-memory-helper-")
        val nodeProperty = "ppphp.language.server.node.path"
        val previous = System.getProperty(nodeProperty)
        try {
            val node = Files.createFile(root.resolve("node"))
            Files.createDirectories(root.resolve("server"))
            Files.createFile(root.resolve("server/server.cjs"))
            System.setProperty(nodeProperty, node.toString())
            PpphpCompilerSettings.getInstance(project).loadState(
                PpphpCompilerSettings.Values().apply { memoryLimitMegabytes = 1024 },
            )
            val command = PpphpLanguageServerRuntime.createCommandLine(project, root, root.toString(), "--rename-symbol")
            assertEquals("1024", command.environment[PpphpCompilerSettings.MEMORY_ENVIRONMENT_VARIABLE])
            assertEquals(listOf(root.resolve("server/server.cjs").toString(), "--rename-symbol"), command.parametersList.list)
        } finally {
            if (previous == null) System.clearProperty(nodeProperty) else System.setProperty(nodeProperty, previous)
            root.toFile().deleteRecursively()
        }
    }
}
