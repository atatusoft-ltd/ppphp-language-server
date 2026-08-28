package com.atatusoft.ppphp

import java.nio.file.Files
import java.nio.file.Path

internal object PpphpPluginPaths {
    fun root(): Path {
        val location = requireNotNull(PpphpPluginPaths::class.java.protectionDomain.codeSource?.location) {
            "Could not locate the ++PHP plugin installation."
        }
        val codeSource = Path.of(location.toURI())
        return if (Files.isRegularFile(codeSource)) {
            requireNotNull(codeSource.parent?.parent) {
                "Could not resolve the ++PHP plugin root from $codeSource."
            }
        } else {
            codeSource
        }
    }
}
