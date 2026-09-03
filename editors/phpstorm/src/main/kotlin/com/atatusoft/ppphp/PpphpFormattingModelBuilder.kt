package com.atatusoft.ppphp

import com.intellij.formatting.Block
import com.intellij.formatting.ChildAttributes
import com.intellij.formatting.FormattingContext
import com.intellij.formatting.FormattingModel
import com.intellij.formatting.FormattingModelBuilder
import com.intellij.formatting.FormattingModelProvider
import com.intellij.formatting.Indent
import com.intellij.formatting.Spacing
import com.intellij.lang.ASTNode
import com.intellij.psi.TokenType
import com.intellij.psi.codeStyle.CommonCodeStyleSettings
import com.intellij.psi.formatter.common.AbstractBlock
import com.jetbrains.php.lang.lexer.PhpTokenTypes

class PpphpFormattingModelBuilder : FormattingModelBuilder {
    override fun createModel(formattingContext: FormattingContext): FormattingModel {
        val settings = formattingContext.codeStyleSettings
        return FormattingModelProvider.createFormattingModelForPsiFile(
            formattingContext.containingFile,
            PpphpFormattingBlock(
                formattingContext.node,
                settings.getCommonSettings(PpphpLanguage.INSTANCE),
                settings.getCustomSettings(PpphpCodeStyleSettings::class.java),
                settings.getLanguageIndentOptions(PpphpLanguage.INSTANCE),
            ),
            settings,
        )
    }
}

private class PpphpFormattingBlock(
    node: ASTNode,
    private val common: CommonCodeStyleSettings,
    private val php: PpphpCodeStyleSettings,
    private val indentOptions: CommonCodeStyleSettings.IndentOptions,
) : AbstractBlock(node, null, null) {
    override fun buildChildren(): List<Block> {
        if (isOpaque()) return emptyList()
        val children = mutableListOf<Block>()
        collectLeaves(myNode, children)
        return children
    }

    private fun collectLeaves(node: ASTNode, children: MutableList<Block>) {
        var child = node.firstChildNode
        while (child != null) {
            when {
                child.elementType === TokenType.WHITE_SPACE -> Unit
                child.firstChildNode == null || child.elementType in OPAQUE_ELEMENTS ->
                    children += PpphpFormattingBlock(child, common, php, indentOptions)

                else -> collectLeaves(child, children)
            }
            child = child.treeNext
        }
    }

    override fun getIndent(): Indent = absoluteIndent(ownDelimiter = isDelimiter())

    override fun getSpacing(child1: Block?, child2: Block): Spacing? {
        val left = child1 as? PpphpFormattingBlock ?: return null
        val right = child2 as? PpphpFormattingBlock ?: return null
        return PpphpSpacing.create(left, right, common, php)
    }

    override fun getChildAttributes(newChildIndex: Int): ChildAttributes {
        val next = subBlocks.getOrNull(newChildIndex) as? PpphpFormattingBlock
        val previous = subBlocks.getOrNull(newChildIndex - 1) as? PpphpFormattingBlock
        val columns = when (next?.firstText()) {
            "}" -> next.absoluteIndentColumns(ownDelimiter = true) + indentOptions.INDENT_SIZE
            ")", "]" ->
                next.absoluteIndentColumns(ownDelimiter = true) + indentOptions.CONTINUATION_INDENT_SIZE

            null -> when (previous?.lastText()) {
                "{" -> previous.absoluteIndentColumns(ownDelimiter = true) + indentOptions.INDENT_SIZE
                "(", "[" ->
                    previous.absoluteIndentColumns(ownDelimiter = true) + indentOptions.CONTINUATION_INDENT_SIZE

                else -> previous?.absoluteIndentColumns(ownDelimiter = false) ?: 0
            }

            else -> next.absoluteIndentColumns(ownDelimiter = false)
        }
        return ChildAttributes(spaceIndent(columns), null)
    }

    override fun isLeaf(): Boolean = myNode.firstChildNode == null || isOpaque()

    fun firstText(): String = generateSequence(myNode) { it.firstChildNode }.last().text

    fun lastText(): String = generateSequence(myNode) { it.lastChildNode }.last().text

    fun firstType() = PpphpTokenTypes.unwrap(
        generateSequence(myNode) { it.firstChildNode }.last().elementType,
    )

    fun lastType() = PpphpTokenTypes.unwrap(
        generateSequence(myNode) { it.lastChildNode }.last().elementType,
    )

    fun parentPrefix(): String {
        val parent = myNode.treeParent ?: return ""
        val relative = (myNode.startOffset - parent.startOffset).coerceIn(0, parent.textLength)
        return parent.text.substring(0, relative)
    }

    fun parentSuffix(): String {
        val parent = myNode.treeParent ?: return ""
        val relative = (myNode.startOffset - parent.startOffset).coerceIn(0, parent.textLength)
        return parent.text.substring(relative)
    }

    fun groupPrefix(): String {
        val group = myNode.treeParent ?: return ""
        val parent = group.treeParent ?: return ""
        val relative = (group.startOffset - parent.startOffset).coerceIn(0, parent.textLength)
        return parent.text.substring(0, relative)
    }

    fun parentElementType() = myNode.treeParent?.elementType

    private fun isOpaque(): Boolean = myNode.elementType in OPAQUE_ELEMENTS

    private fun absoluteIndent(ownDelimiter: Boolean): Indent =
        spaceIndent(absoluteIndentColumns(ownDelimiter))

    fun absoluteIndentColumns(ownDelimiter: Boolean): Int {
        var blocks = 0
        var shiftedBlocks = 0
        var continuations = 0
        var ancestor = myNode.treeParent
        while (ancestor != null) {
            when (ancestor.elementType) {
                PpphpElementTypes.BLOCK -> {
                    blocks++
                    val style = blockBraceStyle(ancestor)
                    if (style == CommonCodeStyleSettings.NEXT_LINE_SHIFTED2) {
                        shiftedBlocks++
                    } else if (
                        ownDelimiter &&
                        ancestor === myNode.treeParent &&
                        style == CommonCodeStyleSettings.NEXT_LINE_SHIFTED
                    ) {
                        shiftedBlocks++
                    }
                }
                PpphpElementTypes.PARENTHESIZED,
                PpphpElementTypes.BRACKETED,
                -> continuations++
            }
            ancestor = ancestor.treeParent
        }
        if (ownDelimiter) {
            when (firstText()) {
                "{", "}" -> blocks--
                "(", ")", "[", "]" -> continuations--
            }
        }
        return (blocks.coerceAtLeast(0) + shiftedBlocks) * indentOptions.INDENT_SIZE +
            continuations.coerceAtLeast(0) * indentOptions.CONTINUATION_INDENT_SIZE
    }

    private fun blockBraceStyle(block: ASTNode): Int {
        val parent = block.treeParent ?: return common.BRACE_STYLE
        val relative = (block.startOffset - parent.startOffset).coerceIn(0, parent.textLength)
        return PpphpSpacing.braceStyle(parent.text.substring(0, relative), common, php)
    }

    private fun isDelimiter(): Boolean = firstText() in DELIMITERS

    private fun spaceIndent(columns: Int): Indent =
        if (columns <= 0) Indent.getAbsoluteNoneIndent() else Indent.getSpaceIndent(columns)

    companion object {
        private val DELIMITERS = setOf("{", "}", "(", ")", "[", "]")
        private val OPAQUE_ELEMENTS = setOf(
            PpphpElementTypes.INTERPOLATED_STRING,
            PpphpElementTypes.HEREDOC,
        )
    }
}

private object PpphpSpacing {
    private val classKeywords = setOf("class", "interface", "trait", "enum")
    private val assignmentOperators = setOf("=", "+=", "-=", "*=", "/=", "%=", ".=", "??=")
    private val logicalOperators = setOf("&&", "||")
    private val wordLogicalOperators = setOf("and", "or", "xor")
    private val equalityOperators = setOf("==", "!=", "===", "!==", "<=>")
    private val relationalOperators = setOf("<", ">", "<=", ">=")
    private val bitwiseOperators = setOf("&", "|", "^")
    private val additiveOperators = setOf("+", "-")
    private val multiplicativeOperators = setOf("*", "/", "%", "**")
    private val shiftOperators = setOf("<<", ">>", "<<=", ">>=")
    private val tightOperators = setOf("\\", "->", "?->", "::", "...")

    fun create(
        left: PpphpFormattingBlock,
        right: PpphpFormattingBlock,
        common: CommonCodeStyleSettings,
        php: PpphpCodeStyleSettings,
    ): Spacing {
        val leftText = left.lastText()
        val rightText = right.firstText()
        val keepBlankLines = when (left.parentElementType()) {
            PpphpElementTypes.BLOCK -> common.KEEP_BLANK_LINES_IN_CODE
            else -> common.KEEP_BLANK_LINES_IN_DECLARATIONS
        }

        fun spaces(count: Int): Spacing = spacing(count, 0, common, keepBlankLines)
        fun lines(blankLines: Int = 0, keptBlankLines: Int = keepBlankLines): Spacing =
            spacing(
                0,
                blankLines.coerceAtLeast(0) + 1,
                common,
                keptBlankLines.coerceAtLeast(blankLines),
            )

        if (left.lastType() in PhpTokenTypes.COMMENTS) return lines()
        if (right.firstType() in PhpTokenTypes.COMMENTS) return spaces(1)

        minimumBlankLines(left, right, common, php)?.let { return lines(it) }

        if (leftText == "<?php" || leftText == "<?") return lines(php.BLANK_LINES_AFTER_OPENING_TAG)

        if (leftText == "{" && rightText == "}") {
            return if (forceEmptyBlockOnOneLine(left, php)) spaces(0) else lines()
        }
        if (leftText == "{") return lines(keptBlankLines = php.KEEP_BLANK_LINES_AFTER_LBRACE)
        if (rightText == "}") {
            return lines(keptBlankLines = common.KEEP_BLANK_LINES_BEFORE_RBRACE)
        }

        if (rightText == "{") return spacingBeforeBrace(right, common, php, keepBlankLines)
        if (leftText == "}" && rightText in setOf("else", "elseif", "catch", "finally")) {
            val newLine = when (rightText) {
                "else", "elseif" -> common.ELSE_ON_NEW_LINE
                "catch" -> common.CATCH_ON_NEW_LINE
                else -> common.FINALLY_ON_NEW_LINE
            }
            return if (newLine) lines() else spaces(1)
        }

        if (rightText == ",") return spaces(if (common.SPACE_BEFORE_COMMA) 1 else 0)
        if (leftText == ",") return spaces(if (common.SPACE_AFTER_COMMA) 1 else 0)
        if (rightText == ";") return spaces(if (common.SPACE_BEFORE_SEMICOLON) 1 else 0)
        if (leftText == ";") {
            return if (left.parentElementType() == PpphpElementTypes.PARENTHESIZED) {
                spaces(if (common.SPACE_AFTER_SEMICOLON) 1 else 0)
            } else {
                lines()
            }
        }

        if (leftText in tightOperators || rightText in tightOperators) return spaces(0)
        if (leftText == "#[" || rightText == "]" && left.groupPrefix().trimEnd().endsWith("#[")) {
            return spaces(0)
        }
        if (rightText == "[" && !startsArrayLiteral(leftText)) return spaces(0)
        if (isGenericBoundary(left, right)) return spaces(0)

        if (rightText == "(") return spaces(if (spaceBeforeParenthesis(left, common, php)) 1 else 0)
        if (leftText == "(" || rightText == ")") {
            return spaces(if (spaceWithinParentheses(left, right, common)) 1 else 0)
        }
        if (leftText == "[" || rightText == "]") {
            return spaces(if (common.SPACE_WITHIN_BRACKETS) 1 else 0)
        }

        if (rightText == ":") return spaces(if (spaceBeforeColon(right, php)) 1 else 0)
        if (leftText == ":") return spaces(if (spaceAfterColon(left, php)) 1 else 0)
        if (leftText == "=>" || rightText == "=>") return spaces(if (php.SPACES_AROUND_ARROW) 1 else 0)
        if (leftText in setOf("??", "??=") || rightText in setOf("??", "??=")) {
            return spaces(if (php.SPACES_AROUND_NULL_COALESCE_OPERATOR) 1 else 0)
        }
        if (leftText == "." || rightText == ".") return spaces(if (php.CONCAT_SPACES) 1 else 0)
        if (leftText == "!" || rightText == "!") {
            val enabled = if (leftText == "!") php.SPACE_AFTER_UNARY_NOT else php.SPACE_BEFORE_UNARY_NOT
            return spaces(if (enabled) 1 else 0)
        }
        if (leftText in setOf("~", "++", "--") || rightText in setOf("~", "++", "--")) {
            return spaces(if (common.SPACE_AROUND_UNARY_OPERATOR) 1 else 0)
        }

        binarySpacing(leftText, rightText, common)?.let { return spaces(if (it) 1 else 0) }
        return spaces(1)
    }

    private fun spacing(
        spaces: Int,
        lineFeeds: Int,
        common: CommonCodeStyleSettings,
        keepBlankLines: Int,
        preserveLineBreaks: Boolean = common.KEEP_LINE_BREAKS,
    ): Spacing = Spacing.createSpacing(
        spaces,
        spaces,
        lineFeeds,
        preserveLineBreaks,
        keepBlankLines,
    )

    private fun minimumBlankLines(
        left: PpphpFormattingBlock,
        right: PpphpFormattingBlock,
        common: CommonCodeStyleSettings,
        php: PpphpCodeStyleSettings,
    ): Int? {
        val leftKind = statementKindBefore(left)
        val rightKind = declarationKindAt(right)
        if (rightKind == "namespace") return common.BLANK_LINES_BEFORE_PACKAGE
        if (leftKind == "namespace") return common.BLANK_LINES_AFTER_PACKAGE
        if (rightKind == "use" && leftKind != "use") return common.BLANK_LINES_BEFORE_IMPORTS
        if (leftKind == "use") {
            return if (rightKind == "use") php.BLANK_LINES_BETWEEN_IMPORTS else common.BLANK_LINES_AFTER_IMPORTS
        }
        val startsAfterDeclaration = left.lastText() in setOf(";", "}")
        if (rightKind in classKeywords && startsAfterDeclaration) {
            return common.BLANK_LINES_AROUND_CLASS
        }
        if (
            rightKind == "function" &&
            left.parentElementType() == PpphpElementTypes.BLOCK &&
            startsAfterDeclaration
        ) {
            return common.BLANK_LINES_AROUND_METHOD
        }
        return null
    }

    private fun statementKindBefore(block: PpphpFormattingBlock): String? {
        if (block.lastText() != ";") return null
        val statement = block.parentPrefix().substringAfterLast(";").substringAfterLast("{")
        return Regex("\\b(namespace|use)\\b", RegexOption.IGNORE_CASE)
            .find(statement)?.groupValues?.get(1)?.lowercase()
    }

    private fun declarationKindAt(block: PpphpFormattingBlock): String? {
        val suffix = block.parentSuffix().trimStart()
        val match = Regex(
            "^(?:(?:#\\[[^]]*]|abstract|final|readonly|public|protected|private|static)\\s+)*(namespace|use|class|interface|trait|enum|function)\\b",
            RegexOption.IGNORE_CASE,
        ).find(suffix)
        return match?.groupValues?.get(1)?.lowercase()
    }

    private fun forceEmptyBlockOnOneLine(
        left: PpphpFormattingBlock,
        php: PpphpCodeStyleSettings,
    ): Boolean {
        val prefix = left.groupPrefix()
        return when {
            classKeywords.any { Regex("\\b$it\\b[^{};]*$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) } ->
                php.FORCE_EMPTY_CLASSES_IN_ONE_LINE

            Regex("\\bfunction\\b[^{};]*$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
                php.FORCE_EMPTY_METHODS_IN_ONE_LINE

            else -> false
        }
    }

    private fun spacingBeforeBrace(
        right: PpphpFormattingBlock,
        common: CommonCodeStyleSettings,
        php: PpphpCodeStyleSettings,
        keepBlankLines: Int,
    ): Spacing {
        val prefix = right.groupPrefix()
        val style = braceStyle(prefix, common, php)
        val wrapped = Regex(
            "\\b(?:class|interface|trait|enum|function|if|elseif|else|for|foreach|while|switch|try|catch|finally)\\b[^{};]*$",
            RegexOption.IGNORE_CASE,
        ).find(prefix)?.value?.contains('\n') == true
        val lineFeeds = when (style) {
            CommonCodeStyleSettings.END_OF_LINE -> 0
            CommonCodeStyleSettings.NEXT_LINE_IF_WRAPPED -> if (wrapped) 1 else 0
            else -> 1
        }
        val spaces = if (lineFeeds == 0 && spaceBeforeBrace(prefix, common)) 1 else 0
        return spacing(spaces, lineFeeds, common, keepBlankLines, false)
    }

    fun braceStyle(
        prefix: String,
        common: CommonCodeStyleSettings,
        php: PpphpCodeStyleSettings,
    ): Int = when {
        Regex("\\bnamespace\\b[^{};]*$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
            php.NAMESPACE_BRACE_STYLE

        classKeywords.any { Regex("\\b$it\\b[^{};]*$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) } ->
            common.CLASS_BRACE_STYLE

        Regex("\\bfunction\\s*\\(", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
            php.ANONYMOUS_BRACE_STYLE

        Regex("\\bfunction\\b[^{};]*$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
            common.METHOD_BRACE_STYLE

        else -> common.BRACE_STYLE
    }

    private fun spaceBeforeBrace(prefix: String, common: CommonCodeStyleSettings): Boolean = when {
        classKeywords.any { Regex("\\b$it\\b[^{};]*$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) } ->
            common.SPACE_BEFORE_CLASS_LBRACE

        Regex("\\bfunction\\b[^{};]*$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
            common.SPACE_BEFORE_METHOD_LBRACE

        Regex("\\belse(?:if)?\\b[^{};]*$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
            common.SPACE_BEFORE_ELSE_LBRACE

        Regex("\\bwhile\\b[^{};]*$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
            common.SPACE_BEFORE_WHILE_LBRACE

        Regex("\\b(?:for|foreach)\\b[^{};]*$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
            common.SPACE_BEFORE_FOR_LBRACE

        Regex("\\btry\\b[^{};]*$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
            common.SPACE_BEFORE_TRY_LBRACE

        Regex("\\bcatch\\b[^{};]*$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
            common.SPACE_BEFORE_CATCH_LBRACE

        Regex("\\bfinally\\b[^{};]*$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
            common.SPACE_BEFORE_FINALLY_LBRACE

        else -> common.SPACE_BEFORE_IF_LBRACE
    }

    private fun spaceBeforeParenthesis(
        left: PpphpFormattingBlock,
        common: CommonCodeStyleSettings,
        php: PpphpCodeStyleSettings,
    ): Boolean {
        val keyword = left.lastText().lowercase()
        return when (keyword) {
            "if", "elseif", "when" -> common.SPACE_BEFORE_IF_PARENTHESES
            "while" -> common.SPACE_BEFORE_WHILE_PARENTHESES
            "for", "foreach" -> common.SPACE_BEFORE_FOR_PARENTHESES
            "switch" -> common.SPACE_BEFORE_SWITCH_PARENTHESES
            "catch" -> common.SPACE_BEFORE_CATCH_PARENTHESES
            "function", "fn" -> if (keyword == "fn") {
                php.SPACE_BEFORE_SHORT_CLOSURE_LEFT_PARENTHESIS
            } else {
                php.SPACE_BEFORE_CLOSURE_LEFT_PARENTHESIS
            }

            else -> {
                val declaration = Regex("\\bfunction\\s+[A-Z_][A-Z0-9_]*$", RegexOption.IGNORE_CASE)
                    .containsMatchIn(left.parentPrefix() + left.lastText())
                if (declaration) common.SPACE_BEFORE_METHOD_PARENTHESES else common.SPACE_BEFORE_METHOD_CALL_PARENTHESES
            }
        }
    }

    private fun spaceWithinParentheses(
        left: PpphpFormattingBlock,
        right: PpphpFormattingBlock,
        common: CommonCodeStyleSettings,
    ): Boolean {
        val prefix = (if (left.lastText() == "(") left.groupPrefix() else right.groupPrefix()).trimEnd()
        return when {
            Regex("\\bfunction\\s+[A-Z_][A-Z0-9_]*$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
                common.SPACE_WITHIN_METHOD_PARENTHESES

            Regex("\\b(?:if|elseif|when)$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
                common.SPACE_WITHIN_IF_PARENTHESES

            Regex("\\bwhile$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
                common.SPACE_WITHIN_WHILE_PARENTHESES

            Regex("\\b(?:for|foreach)$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
                common.SPACE_WITHIN_FOR_PARENTHESES

            Regex("\\bswitch$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
                common.SPACE_WITHIN_SWITCH_PARENTHESES

            Regex("\\bcatch$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
                common.SPACE_WITHIN_CATCH_PARENTHESES

            Regex("(?:[A-Z_][A-Z0-9_]*|\\)|\\])$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
                common.SPACE_WITHIN_METHOD_CALL_PARENTHESES

            else -> common.SPACE_WITHIN_PARENTHESES
        }
    }

    private fun binarySpacing(
        left: String,
        right: String,
        common: CommonCodeStyleSettings,
    ): Boolean? {
        if (left in additiveOperators && right in additiveOperators) return true
        val operator = (assignmentOperators + logicalOperators + wordLogicalOperators +
            equalityOperators + relationalOperators + bitwiseOperators + additiveOperators +
            multiplicativeOperators + shiftOperators).firstOrNull { it == left || it == right }
            ?: return null
        return when (operator) {
            in assignmentOperators -> common.SPACE_AROUND_ASSIGNMENT_OPERATORS
            in logicalOperators -> common.SPACE_AROUND_LOGICAL_OPERATORS
            in wordLogicalOperators -> true
            in equalityOperators -> common.SPACE_AROUND_EQUALITY_OPERATORS
            in relationalOperators -> common.SPACE_AROUND_RELATIONAL_OPERATORS
            in bitwiseOperators -> common.SPACE_AROUND_BITWISE_OPERATORS
            in additiveOperators -> common.SPACE_AROUND_ADDITIVE_OPERATORS
            in multiplicativeOperators -> common.SPACE_AROUND_MULTIPLICATIVE_OPERATORS
            in shiftOperators -> common.SPACE_AROUND_SHIFT_OPERATORS
            else -> true
        }
    }

    private fun spaceBeforeColon(right: PpphpFormattingBlock, php: PpphpCodeStyleSettings): Boolean {
        val prefix = right.parentPrefix()
        return when {
            Regex("\\b(?:function|fn)\\b[^{};]*\\)$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
                php.SPACE_BEFORE_COLON_IN_RETURN_TYPE

            Regex("\\benum\\s+[A-Z_][A-Z0-9_]*$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
                php.SPACE_BEFORE_COLON_IN_ENUM_BACKED_TYPE

            else -> php.SPACE_BEFORE_COLON_IN_NAMED_ARGUMENT
        }
    }

    private fun spaceAfterColon(left: PpphpFormattingBlock, php: PpphpCodeStyleSettings): Boolean {
        val prefix = left.parentPrefix()
        return when {
            Regex("\\b(?:function|fn)\\b[^{};]*\\)$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
                php.SPACE_AFTER_COLON_IN_RETURN_TYPE

            Regex("\\benum\\s+[A-Z_][A-Z0-9_]*$", RegexOption.IGNORE_CASE).containsMatchIn(prefix) ->
                php.SPACE_AFTER_COLON_IN_ENUM_BACKED_TYPE

            else -> php.SPACE_AFTER_COLON_IN_NAMED_ARGUMENT
        }
    }

    private fun isGenericBoundary(
        left: PpphpFormattingBlock,
        right: PpphpFormattingBlock,
    ): Boolean {
        val leftText = left.lastText()
        val rightText = right.firstText()
        return rightText == "<" && looksLikeType(leftText) ||
            leftText == "<" && looksLikeType(rightText) ||
            rightText.allGenericClosers() && looksLikeType(leftText) ||
            leftText.allGenericClosers() && rightText in setOf(">", ",", "?", "[", ")")
    }

    private fun String.allGenericClosers(): Boolean = isNotEmpty() && all { it == '>' }

    private fun looksLikeType(text: String): Boolean =
        text.firstOrNull()?.isUpperCase() == true || text.lowercase() in BUILTIN_TYPES

    private fun startsArrayLiteral(left: String): Boolean =
        left in setOf("=", "=>", ",", "(", "[", "return", "yield", ":")

    private val BUILTIN_TYPES = setOf(
        "array", "bool", "callable", "false", "float", "int", "iterable", "mixed", "never",
        "null", "object", "self", "static", "string", "true", "void",
    )
}
