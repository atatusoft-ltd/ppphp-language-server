package com.atatusoft.ppphp

import com.intellij.extapi.psi.ASTWrapperPsiElement
import com.intellij.extapi.psi.PsiFileBase
import com.intellij.lang.ASTNode
import com.intellij.lang.ParserDefinition
import com.intellij.lang.PsiBuilder
import com.intellij.lang.PsiParser
import com.intellij.lexer.Lexer
import com.intellij.openapi.project.Project
import com.intellij.psi.FileViewProvider
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiFile
import com.intellij.psi.tree.IElementType
import com.intellij.psi.tree.IFileElementType
import com.intellij.psi.tree.TokenSet
import com.jetbrains.php.lang.lexer.PhpLexer
import com.jetbrains.php.lang.lexer.PhpTokenTypes

class PpphpParserDefinition : ParserDefinition {
    override fun createLexer(project: Project?): Lexer =
        PpphpLexer(createPhpLexer(project))

    override fun createParser(project: Project?): PsiParser = PsiParser { root, builder ->
        val file = builder.mark()
        parseChildren(builder, null)
        file.done(root)
        builder.treeBuilt
    }

    override fun getFileNodeType(): IFileElementType = FILE

    override fun getWhitespaceTokens(): TokenSet = TokenSet.create(PpphpTokenTypes.WHITE_SPACE)

    override fun getCommentTokens(): TokenSet = PpphpTokenTypes.COMMENTS

    override fun getStringLiteralElements(): TokenSet = PpphpTokenTypes.STRINGS

    override fun createElement(node: ASTNode): PsiElement = ASTWrapperPsiElement(node)

    override fun createFile(viewProvider: FileViewProvider): PsiFile = PpphpPsiFile(viewProvider)

    override fun spaceExistenceTypeBetweenTokens(
        left: ASTNode?,
        right: ASTNode?,
    ): ParserDefinition.SpaceRequirements = ParserDefinition.SpaceRequirements.MAY

    companion object {
        val FILE = IFileElementType(PpphpLanguage.INSTANCE)

        private fun createPhpLexer(@Suppress("UNUSED_PARAMETER") project: Project?): Lexer =
            PhpLexer(false)

        private fun parseChildren(builder: PsiBuilder, closingType: IElementType?) {
            while (
                !builder.eof() &&
                    (closingType == null || PpphpTokenTypes.unwrap(builder.tokenType) !== closingType)
            ) {
                when (PpphpTokenTypes.unwrap(builder.tokenType)) {
                    PhpTokenTypes.chLSINGLE_QUOTE ->
                        parseOpaque(
                            builder,
                            PhpTokenTypes.chRSINGLE_QUOTE,
                            PpphpElementTypes.INTERPOLATED_STRING,
                        )

                    PhpTokenTypes.chLDOUBLE_QUOTE ->
                        parseOpaque(
                            builder,
                            PhpTokenTypes.chRDOUBLE_QUOTE,
                            PpphpElementTypes.INTERPOLATED_STRING,
                        )

                    PhpTokenTypes.chLBACKTRICK ->
                        parseOpaque(
                            builder,
                            PhpTokenTypes.chRBACKTRICK,
                            PpphpElementTypes.INTERPOLATED_STRING,
                        )

                    PhpTokenTypes.HEREDOC_START ->
                        parseOpaque(
                            builder,
                            PhpTokenTypes.HEREDOC_END,
                            PpphpElementTypes.HEREDOC,
                        )

                    PhpTokenTypes.chLBRACE ->
                        parseDelimited(builder, PhpTokenTypes.chRBRACE, PpphpElementTypes.BLOCK)

                    PhpTokenTypes.chLPAREN ->
                        parseDelimited(
                            builder,
                            PhpTokenTypes.chRPAREN,
                            PpphpElementTypes.PARENTHESIZED,
                        )

                    PhpTokenTypes.chLBRACKET ->
                        parseDelimited(builder, PhpTokenTypes.chRBRACKET, PpphpElementTypes.BRACKETED)

                    else -> builder.advanceLexer()
                }
            }
        }

        private fun parseDelimited(
            builder: PsiBuilder,
            closingType: IElementType,
            elementType: IElementType,
        ) {
            val group = builder.mark()
            builder.advanceLexer()
            parseChildren(builder, closingType)
            if (PpphpTokenTypes.unwrap(builder.tokenType) === closingType) {
                builder.advanceLexer()
            }
            group.done(elementType)
        }

        private fun parseOpaque(
            builder: PsiBuilder,
            closingType: IElementType,
            elementType: IElementType,
        ) {
            val group = builder.mark()
            builder.advanceLexer()
            while (
                !builder.eof() &&
                PpphpTokenTypes.unwrap(builder.tokenType) !== closingType
            ) {
                builder.advanceLexer()
            }
            if (PpphpTokenTypes.unwrap(builder.tokenType) === closingType) {
                builder.advanceLexer()
            }
            group.done(elementType)
        }
    }
}

internal object PpphpElementTypes {
    val BLOCK = IElementType("++PHP block", PpphpLanguage.INSTANCE)
    val PARENTHESIZED = IElementType("++PHP parenthesized", PpphpLanguage.INSTANCE)
    val BRACKETED = IElementType("++PHP bracketed", PpphpLanguage.INSTANCE)
    val INTERPOLATED_STRING = IElementType("++PHP interpolated string", PpphpLanguage.INSTANCE)
    val HEREDOC = IElementType("++PHP heredoc", PpphpLanguage.INSTANCE)
}

class PpphpPsiFile(viewProvider: FileViewProvider) :
    PsiFileBase(viewProvider, PpphpLanguage.INSTANCE) {
    override fun getFileType(): PpphpFileType = PpphpFileType.INSTANCE

    override fun toString(): String = "++PHP File"
}
