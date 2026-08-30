package com.atatusoft.ppphp

import com.intellij.lexer.Lexer
import com.intellij.psi.tree.IElementType
import com.jetbrains.php.lang.lexer.PhpTokenTypes

internal enum class PpphpSyntaxRole {
    CONTEXTUAL_KEYWORD,
    TYPE_NAME,
}

internal data class PpphpTokenRange(
    val startOffset: Int,
    val endOffset: Int,
)

internal object PpphpSyntaxClassifier {
    fun classify(source: CharSequence, phpLexer: Lexer): Map<PpphpTokenRange, PpphpSyntaxRole> {
        val tokens = tokenize(source, phpLexer)
        if (tokens.isEmpty()) return emptyMap()

        val roles = mutableMapOf<PpphpTokenRange, PpphpSyntaxRole>()
        tokens.forEach { token ->
            if (
                token.type === PhpTokenTypes.IDENTIFIER &&
                    token.text.lowercase() in CONTEXTUAL_KEYWORDS
            ) {
                roles[token.range] = PpphpSyntaxRole.CONTEXTUAL_KEYWORD
            }
        }
        markTypedBindings(tokens, roles)
        markThrowsClauses(tokens, roles)
        return roles.toMap()
    }

    private fun markTypedBindings(
        tokens: List<Lexeme>,
        roles: MutableMap<PpphpTokenRange, PpphpSyntaxRole>,
    ) {
        tokens.forEachIndexed { variableIndex, variable ->
            if (variable.type !== PhpTokenTypes.VARIABLE) return@forEachIndexed
            if (!isTypedBindingTerminator(tokens.getOrNull(variableIndex + 1)?.text)) {
                return@forEachIndexed
            }

            val parsed = resolveTypedPrefix(tokens, variableIndex) ?: return@forEachIndexed
            parsed.readonlyIndex?.let { index ->
                roles[tokens[index].range] = PpphpSyntaxRole.CONTEXTUAL_KEYWORD
            }
            markTypes(tokens, parsed.typeTokenIndices, roles)
        }
    }

    private fun markThrowsClauses(
        tokens: List<Lexeme>,
        roles: MutableMap<PpphpTokenRange, PpphpSyntaxRole>,
    ) {
        tokens.forEachIndexed { keywordIndex, keyword ->
            if (!keyword.text.equals("throws", ignoreCase = true)) return@forEachIndexed

            var position = keywordIndex + 1
            val typeTokenIndices = linkedSetOf<Int>()
            while (position < tokens.size) {
                val parsed = parseCompositeType(tokens, position, tokens.size) ?: return@forEachIndexed
                typeTokenIndices.addAll(parsed.typeTokenIndices)
                position = parsed.nextIndex

                when (tokens.getOrNull(position)?.text) {
                    "," -> position++
                    "{", ";" -> {
                        roles[keyword.range] = PpphpSyntaxRole.CONTEXTUAL_KEYWORD
                        markTypes(tokens, typeTokenIndices, roles)
                        return@forEachIndexed
                    }
                    else -> return@forEachIndexed
                }
            }
        }
    }

    private fun resolveTypedPrefix(tokens: List<Lexeme>, variableIndex: Int): ParsedPrefix? {
        val earliestCandidate = maxOf(0, variableIndex - MAX_TYPE_TOKENS)
        for (candidate in earliestCandidate until variableIndex) {
            var typeStart = candidate
            var readonlyIndex: Int? = null
            if (tokens[typeStart].text.equals("readonly", ignoreCase = true)) {
                readonlyIndex = typeStart
                typeStart++
            }
            if (typeStart >= variableIndex) continue

            val parsed = parseCompositeType(tokens, typeStart, variableIndex) ?: continue
            if (parsed.nextIndex == variableIndex) {
                return ParsedPrefix(readonlyIndex, parsed.typeTokenIndices)
            }
        }
        return null
    }

    private fun parseCompositeType(
        tokens: List<Lexeme>,
        startIndex: Int,
        endIndex: Int,
    ): ParsedType? {
        var parsed = parsePrimaryType(tokens, startIndex, endIndex) ?: return null
        val typeTokenIndices = linkedSetOf<Int>().apply { addAll(parsed.typeTokenIndices) }
        var position = parsed.nextIndex

        while (position < endIndex && tokens[position].text in COMPOSITE_TYPE_OPERATORS) {
            parsed = parsePrimaryType(tokens, position + 1, endIndex) ?: return null
            typeTokenIndices.addAll(parsed.typeTokenIndices)
            position = parsed.nextIndex
        }
        return ParsedType(position, typeTokenIndices)
    }

    private fun parsePrimaryType(
        tokens: List<Lexeme>,
        startIndex: Int,
        endIndex: Int,
    ): ParsedType? {
        var position = startIndex
        val typeTokenIndices = linkedSetOf<Int>()
        if (position < endIndex && tokens[position].text == "?") position++
        if (position >= endIndex) return null

        if (tokens[position].text == "(") {
            val nested = parseCompositeType(tokens, position + 1, endIndex) ?: return null
            if (nested.nextIndex >= endIndex || tokens[nested.nextIndex].text != ")") return null
            return ParsedType(nested.nextIndex + 1, nested.typeTokenIndices)
        }

        if (tokens[position].text == "\\") position++
        if (position >= endIndex || !tokens[position].isTypeName()) return null
        typeTokenIndices.add(position)
        position++

        while (
            position + 1 < endIndex &&
                tokens[position].text == "\\" &&
                tokens[position + 1].isTypeName()
        ) {
            typeTokenIndices.add(position + 1)
            position += 2
        }

        if (position >= endIndex || tokens[position].text != "<") {
            return ParsedType(position, typeTokenIndices)
        }

        position++
        if (position >= endIndex || tokens[position].text == ">") return null
        while (true) {
            val argument = parseCompositeType(tokens, position, endIndex) ?: return null
            typeTokenIndices.addAll(argument.typeTokenIndices)
            position = argument.nextIndex
            when {
                position < endIndex && tokens[position].text == "," -> position++
                position < endIndex && tokens[position].text == ">" ->
                    return ParsedType(position + 1, typeTokenIndices)
                else -> return null
            }
        }
    }

    private fun markTypes(
        tokens: List<Lexeme>,
        indices: Set<Int>,
        roles: MutableMap<PpphpTokenRange, PpphpSyntaxRole>,
    ) {
        indices.forEach { index -> roles[tokens[index].range] = PpphpSyntaxRole.TYPE_NAME }
    }

    private fun tokenize(source: CharSequence, lexer: Lexer): List<Lexeme> {
        val tokens = mutableListOf<Lexeme>()
        lexer.start(source, 0, source.length, 0)
        while (lexer.tokenType != null) {
            val type = lexer.tokenType!!
            if (type !== PhpTokenTypes.WHITE_SPACE && !PhpTokenTypes.COMMENTS.contains(type)) {
                val text = lexer.tokenText
                if (text == ">>") {
                    tokens.add(Lexeme(type, ">", lexer.tokenStart, lexer.tokenStart + 1))
                    tokens.add(Lexeme(type, ">", lexer.tokenStart + 1, lexer.tokenEnd))
                } else {
                    tokens.add(Lexeme(type, text, lexer.tokenStart, lexer.tokenEnd))
                }
            }
            lexer.advance()
        }
        return tokens
    }

    private fun Lexeme.isTypeName(): Boolean =
        !text.equals("readonly", ignoreCase = true) &&
            !text.equals("val", ignoreCase = true) &&
            !text.equals("var", ignoreCase = true) &&
            (
                type === PhpTokenTypes.IDENTIFIER ||
                    type === PhpTokenTypes.PREDEFINED_IDENTIFIER ||
                    type === PhpTokenTypes.kwARRAY ||
                    type === PhpTokenTypes.kwCALLABLE ||
                    type === PhpTokenTypes.kwSTATIC
            )

    private fun isTypedBindingTerminator(text: String?): Boolean =
        text == "=" || text == "=>" || text == ")"

    private data class Lexeme(
        val type: IElementType,
        val text: String,
        val startOffset: Int,
        val endOffset: Int,
    ) {
        val range = PpphpTokenRange(startOffset, endOffset)
    }

    private data class ParsedType(
        val nextIndex: Int,
        val typeTokenIndices: Set<Int>,
    )

    private data class ParsedPrefix(
        val readonlyIndex: Int?,
        val typeTokenIndices: Set<Int>,
    )

    private val CONTEXTUAL_KEYWORDS = setOf("throws", "when")
    private val COMPOSITE_TYPE_OPERATORS = setOf("|", "&")
    private const val MAX_TYPE_TOKENS = 128
}
