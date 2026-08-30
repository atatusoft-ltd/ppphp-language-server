package com.atatusoft.ppphp

import com.intellij.lexer.Lexer
import com.intellij.lexer.LexerBase
import com.intellij.psi.tree.IElementType

internal class PpphpLexer(
    private val phpLexer: Lexer,
) : LexerBase() {
    override fun start(
        buffer: CharSequence,
        startOffset: Int,
        endOffset: Int,
        initialState: Int,
    ) {
        phpLexer.start(buffer, startOffset, endOffset, initialState)
    }

    override fun getState(): Int = phpLexer.state

    override fun getTokenType(): IElementType? = phpLexer.tokenType?.let(PpphpTokenTypes::wrap)

    override fun getTokenStart(): Int = phpLexer.tokenStart

    override fun getTokenEnd(): Int = phpLexer.tokenEnd

    override fun advance() {
        phpLexer.advance()
    }

    override fun getBufferSequence(): CharSequence = phpLexer.bufferSequence

    override fun getBufferEnd(): Int = phpLexer.bufferEnd
}
