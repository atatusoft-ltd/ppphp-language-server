package com.atatusoft.ppphp

import com.intellij.lang.Language
import com.jetbrains.php.lang.PhpLanguage

class PpphpLanguage private constructor() : Language(PhpLanguage.INSTANCE, "++PHP") {
    companion object {
        @JvmField
        val INSTANCE = PpphpLanguage()
    }
}
