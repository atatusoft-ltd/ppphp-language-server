package com.atatusoft.ppphp

import com.intellij.psi.tree.IElementType
import com.intellij.psi.tree.TokenSet
import com.jetbrains.php.lang.lexer.PhpTokenTypes
import com.jetbrains.php.lang.documentation.phpdoc.parser.PhpDocStubElementTypes
import java.util.concurrent.ConcurrentHashMap

internal class PpphpPhpTokenType(
    val phpTokenType: IElementType,
) : IElementType("++PHP ${phpTokenType}", PpphpLanguage.INSTANCE)

internal object PpphpTokenTypes {
    private val delegatedTypes = ConcurrentHashMap<IElementType, PpphpPhpTokenType>()

    fun wrap(type: IElementType): IElementType =
        delegatedTypes.computeIfAbsent(type, ::PpphpPhpTokenType)

    fun unwrap(type: IElementType?): IElementType? =
        (type as? PpphpPhpTokenType)?.phpTokenType

    val WHITE_SPACE: IElementType = wrap(PhpTokenTypes.WHITE_SPACE)
    val DOC_COMMENT: IElementType = wrap(PhpDocStubElementTypes.DOC_COMMENT)
    val COMMENTS: TokenSet = TokenSet.orSet(
        wrap(PhpTokenTypes.COMMENTS),
        TokenSet.create(DOC_COMMENT),
    )
    val STRINGS: TokenSet = wrap(PhpTokenTypes.tsSTRINGS)

    private fun wrap(types: TokenSet): TokenSet =
        TokenSet.create(*types.types.map(::wrap).toTypedArray())
}
