package com.atatusoft.ppphp

import com.intellij.openapi.extensions.PluginAware
import com.intellij.openapi.extensions.PluginDescriptor
import java.nio.file.Path
import org.jetbrains.plugins.textmate.api.TextMateBundleProvider

class PpphpTextMateBundleProvider : TextMateBundleProvider, PluginAware {
    private lateinit var pluginRoot: Path

    override fun setPluginDescriptor(pluginDescriptor: PluginDescriptor) {
        pluginRoot = pluginDescriptor.pluginPath
    }

    override fun getBundles(): List<TextMateBundleProvider.PluginBundle> = listOf(
        TextMateBundleProvider.PluginBundle(
            "++PHP",
            pluginRoot.resolve("textmate/ppphp"),
        ),
    )
}
