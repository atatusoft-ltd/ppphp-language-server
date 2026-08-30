package com.atatusoft.ppphp

import com.intellij.openapi.fileTypes.LanguageFileType
import javax.swing.Icon

class PpphpFileType private constructor() : LanguageFileType(PpphpLanguage.INSTANCE) {
    override fun getName(): String = "++PHP"

    override fun getDescription(): String = "++PHP source file"

    override fun getDefaultExtension(): String = "ppphp"

    override fun getIcon(): Icon = PpphpIcons.FILE

    companion object {
        @JvmField
        val INSTANCE = PpphpFileType()
    }
}
