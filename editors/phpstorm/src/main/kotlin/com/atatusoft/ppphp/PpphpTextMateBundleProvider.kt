package com.atatusoft.ppphp

import org.jetbrains.plugins.textmate.api.TextMateBundleProvider

class PpphpTextMateBundleProvider : TextMateBundleProvider {
    override fun getBundles(): List<TextMateBundleProvider.PluginBundle> = listOf(
        TextMateBundleProvider.PluginBundle(
            "++PHP",
            PpphpPluginPaths.root().resolve("textmate/ppphp"),
        ),
    )
}
