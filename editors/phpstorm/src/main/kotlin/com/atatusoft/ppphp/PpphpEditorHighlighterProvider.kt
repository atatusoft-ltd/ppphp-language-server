package com.atatusoft.ppphp

import org.jetbrains.plugins.textmate.language.syntax.highlighting.TextMateEditorHighlighterProvider

/**
 * Uses TextMate's scope-aware editor storage for the dynamic token types emitted by its lexer.
 * A regular LexerEditorHighlighter stores token types by the global IElementType index and cannot
 * represent TextMate scopes safely.
 */
class PpphpEditorHighlighterProvider : TextMateEditorHighlighterProvider()
