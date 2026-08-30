package com.atatusoft.ppphp

import com.intellij.lexer.Lexer
import com.intellij.lexer.LexerBase
import com.intellij.psi.tree.IElementType

internal class PpphpLexer(
    private val phpLexer: Lexer,
    private val classificationLexer: Lexer,
) : LexerBase() {
    private var syntaxRoles = emptyMap<PpphpTokenRange, PpphpSyntaxRole>()

    override fun start(
        buffer: CharSequence,
        startOffset: Int,
        endOffset: Int,
        initialState: Int,
    ) {
        syntaxRoles = PpphpSyntaxClassifier.classify(buffer, classificationLexer)
        phpLexer.start(buffer, startOffset, endOffset, initialState)
    }

    override fun getState(): Int = phpLexer.state

    override fun getTokenType(): IElementType? {
        val phpTokenType = phpLexer.tokenType ?: return null
        return when (syntaxRoles[PpphpTokenRange(phpLexer.tokenStart, phpLexer.tokenEnd)]) {
            PpphpSyntaxRole.CONTEXTUAL_KEYWORD -> PpphpTokenTypes.CONTEXTUAL_KEYWORD
            PpphpSyntaxRole.TYPE_NAME -> PpphpTokenTypes.TYPE_NAME
            null -> PpphpTokenTypes.wrap(phpTokenType)
        }
    }

    override fun getTokenStart(): Int = phpLexer.tokenStart

    override fun getTokenEnd(): Int = phpLexer.tokenEnd

    override fun advance() {
        phpLexer.advance()
    }

    override fun getBufferSequence(): CharSequence = phpLexer.bufferSequence

    override fun getBufferEnd(): Int = phpLexer.bufferEnd
}
