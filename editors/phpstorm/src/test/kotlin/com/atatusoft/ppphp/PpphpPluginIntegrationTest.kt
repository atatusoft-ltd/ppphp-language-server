package com.atatusoft.ppphp

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import org.jetbrains.plugins.textmate.TextMateService

class PpphpPluginIntegrationTest : BasePlatformTestCase() {
    fun testPppFilesResolveToThePpphpTextMateGrammar() {
        val descriptor = requireNotNull(
            TextMateService.getInstance().getLanguageDescriptorByFileName("example.ppp"),
        )

        assertEquals("source.ppphp", descriptor.rootScopeName.toString())
    }
}
