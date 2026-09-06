package com.atatusoft.ppphp

import com.intellij.lang.CodeDocumentationAwareCommenterEx
import com.intellij.psi.PsiComment
import com.intellij.psi.PsiElement
import com.jetbrains.php.lang.PhpCommenter
import com.jetbrains.php.lang.lexer.PhpTokenTypes

/** Use the platform's comment editing/Enter behavior with ++PHP's wrapped PHP tokens. */
class PpphpCommenter : CodeDocumentationAwareCommenterEx {
    private val php = PhpCommenter()

    override fun getLineCommentPrefix() = php.lineCommentPrefix
    override fun getBlockCommentPrefix() = php.blockCommentPrefix
    override fun getBlockCommentSuffix() = php.blockCommentSuffix
    override fun getCommentedBlockCommentPrefix() = php.commentedBlockCommentPrefix
    override fun getCommentedBlockCommentSuffix() = php.commentedBlockCommentSuffix
    override fun getLineCommentTokenType() = PpphpTokenTypes.wrap(PhpTokenTypes.LINE_COMMENT)
    override fun getBlockCommentTokenType() = PpphpTokenTypes.wrap(requireNotNull(php.blockCommentTokenType))
    override fun getDocumentationCommentTokenType() = PpphpTokenTypes.wrap(requireNotNull(php.documentationCommentTokenType))
    override fun getDocumentationCommentPrefix() = php.documentationCommentPrefix
    override fun getDocumentationCommentLinePrefix() = php.documentationCommentLinePrefix
    override fun getDocumentationCommentSuffix() = php.documentationCommentSuffix
    override fun isDocumentationComment(comment: PsiComment) = comment.tokenType == documentationCommentTokenType
    override fun isDocumentationCommentText(element: PsiElement?) =
        element is PsiComment && isDocumentationComment(element)
}
