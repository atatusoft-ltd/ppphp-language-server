package com.atatusoft.ppphp

import com.intellij.lang.Language

class PpphpLanguage private constructor() : Language("++PHP") {
    companion object {
        @JvmField
        val INSTANCE = PpphpLanguage()
    }
}
