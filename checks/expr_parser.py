"""Expression parser for cross-field conditions.

Supports a restricted grammar: ==, !=, <, <=, >, >=, +, -, and, or,
field references, string literals, and numeric literals.
Never imports pandas. Unsupported conditions raise ExprParseError.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


class ExprParseError(ValueError):
    """Raised when an expression cannot be parsed."""


@dataclass
class Expr:
    """Base class for parsed expressions."""


@dataclass
class FieldRef(Expr):
    """Reference to a dataframe column."""
    name: str


@dataclass
class Literal(Expr):
    """A string or numeric literal value."""
    value: Any


@dataclass
class BinaryOp(Expr):
    """Binary operation: field op field/literal."""
    op: str
    left: Expr
    right: Expr


@dataclass
class UnaryOp(Expr):
    """Unary operation (not, negation)."""
    op: str
    operand: Expr


class Token:
    """Simple tokenizer for expression strings."""
    
    FIELD = "FIELD"
    NUMBER = "NUMBER"
    STRING = "STRING"
    OP = "OP"
    LPAREN = "LPAREN"
    RPAREN = "RPAREN"
    AND = "AND"
    OR = "OR"
    EOF = "EOF"
    
    def __init__(self, type: str, value: Any, pos: int):
        self.type = type
        self.value = value
        self.pos = pos


class Lexer:
    """Tokenizes expression strings."""
    
    # Valid identifiers: field names, keywords
    FIELD_RE = re.compile(r"[a-zA-Z_][a-zA-Z0-9_]*")
    NUMBER_RE = re.compile(r"-?\d+(\.\d+)?")
    STRING_RE = re.compile(r"'([^']*)'")
    OPS = {"==", "!=", "<", "<=", ">", ">=", "+", "-", "and", "or"}
    
    def __init__(self, text: str):
        self.text = text.strip()
        self.pos = 0
        self.tokens: list[Token] = []
        self._tokenize()
    
    def _tokenize(self) -> None:
        while self.pos < len(self.text):
            ch = self.text[self.pos]
            
            # Skip whitespace
            if ch.isspace():
                self.pos += 1
                continue
            
            # String literal
            if ch == "'":
                m = self.STRING_RE.match(self.text, self.pos)
                if m:
                    self.tokens.append(Token(Token.STRING, m.group(1), self.pos))
                    self.pos = m.end()
                    continue
            
            # Number
            m = self.NUMBER_RE.match(self.text, self.pos)
            if m:
                val = float(m.group()) if "." in m.group() else int(m.group())
                self.tokens.append(Token(Token.NUMBER, val, self.pos))
                self.pos = m.end()
                continue
            
            # Identifier (field or keyword)
            m = self.FIELD_RE.match(self.text, self.pos)
            if m:
                word = m.group().lower()
                if word in ("and", "or"):
                    self.tokens.append(Token(Token.AND if word == "and" else Token.OR, word, self.pos))
                else:
                    self.tokens.append(Token(Token.FIELD, m.group(), self.pos))
                self.pos = m.end()
                continue
            
            # Operators and punctuation
            if ch == "(":
                self.tokens.append(Token(Token.LPAREN, "(", self.pos))
                self.pos += 1
            elif ch == ")":
                self.tokens.append(Token(Token.RPAREN, ")", self.pos))
                self.pos += 1
            elif self.text[self.pos:self.pos+2] in ("<=", ">=", "==", "!="):
                op = self.text[self.pos:self.pos+2]
                self.tokens.append(Token(Token.OP, op, self.pos))
                self.pos += 2
            elif ch in "<>":
                self.tokens.append(Token(Token.OP, ch, self.pos))
                self.pos += 1
            elif ch in "+-":
                self.tokens.append(Token(Token.OP, ch, self.pos))
                self.pos += 1
            else:
                raise ExprParseError(f"Unexpected character '{ch}' at position {self.pos}")
        
        self.tokens.append(Token(Token.EOF, None, self.pos))
    
    def peek(self) -> Token:
        return self.tokens[0]
    
    def consume(self, expected_type: str | None = None) -> Token:
        tok = self.tokens.pop(0)
        if expected_type and tok.type != expected_type:
            raise ExprParseError(
                f"Expected {expected_type}, got {tok.type} ('{tok.value}') at position {tok.pos}"
            )
        return tok


class Parser:
    """Recursive descent parser for expressions.
    
    Grammar:
        expr      → term (('and' | 'or') term)*
        term      → factor (('==' | '!=' | '<' | '<=' | '>' | '>=') factor)*
        factor    → unary (('+' | '-') unary)*
        unary     → ('not')? primary
        primary   → FIELD | NUMBER | STRING | '(' expr ')'
    """
    
    def __init__(self, text: str):
        self.lexer = Lexer(text)
        self.pos = 0
    
    def parse(self) -> Expr:
        expr = self._parse_expr()
        if self.lexer.peek().type != Token.EOF:
            tok = self.lexer.peek()
            raise ExprParseError(f"Unexpected token '{tok.value}' at position {tok.pos}")
        return expr
    
    def _parse_expr(self) -> Expr:
        """Parse logical OR expressions."""
        left = self._parse_term()
        
        while self.lexer.peek().type in (Token.AND, Token.OR):
            op = self.lexer.consume().value
            right = self._parse_term()
            left = BinaryOp(op=op, left=left, right=right)
        
        return left
    
    def _parse_term(self) -> Expr:
        """Parse comparison expressions."""
        left = self._parse_factor()
        
        while self.lexer.peek().type == Token.OP and self.lexer.peek().value in ("==", "!=", "<", "<=", ">", ">="):
            op = self.lexer.consume().value
            right = self._parse_factor()
            left = BinaryOp(op=op, left=left, right=right)
        
        return left
    
    def _parse_factor(self) -> Expr:
        """Parse add/subtract expressions."""
        left = self._parse_unary()
        
        while self.lexer.peek().type == Token.OP and self.lexer.peek().value in ("+", "-"):
            op = self.lexer.consume().value
            right = self._parse_unary()
            left = BinaryOp(op=op, left=left, right=right)
        
        return left
    
    def _parse_unary(self) -> Expr:
        """Parse not expressions."""
        if self.lexer.peek().type == Token.FIELD and self.lexer.peek().value.lower() == "not":
            self.lexer.consume()
            operand = self._parse_unary()
            return UnaryOp(op="not", operand=operand)
        return self._parse_primary()
    
    def _parse_primary(self) -> Expr:
        """Parse field refs, literals, and parenthesized expressions."""
        tok = self.lexer.peek()
        
        if tok.type == Token.FIELD:
            self.lexer.consume()
            return FieldRef(name=tok.value)
        
        if tok.type == Token.NUMBER:
            self.lexer.consume()
            return Literal(value=tok.value)
        
        if tok.type == Token.STRING:
            self.lexer.consume()
            return Literal(value=tok.value)
        
        if tok.type == Token.LPAREN:
            self.lexer.consume()
            expr = self._parse_expr()
            self.lexer.consume(Token.RPAREN)
            return expr
        
        raise ExprParseError(f"Unexpected token '{tok.value}' at position {tok.pos}")


def parse_expression(text: str) -> Expr:
    """Parse a condition expression into an AST.
    
    Raises ExprParseError if the expression cannot be parsed.
    """
    if not text or text.strip() == "":
        raise ExprParseError("Empty expression")
    try:
        parser = Parser(text)
        return parser.parse()
    except (ExprParseError, IndexError, AttributeError) as e:
        raise ExprParseError(f"Failed to parse '{text}': {e}") from e


def validate_expression(text: str) -> tuple[bool, str]:
    """Validate an expression without building the full AST.
    
    Returns (is_valid, error_message).
    """
    try:
        parse_expression(text)
        return True, ""
    except ExprParseError as e:
        return False, str(e)


# SQL-like operators to Polars expression mapping
_OP_MAP = {
    "==": lambda l, r: l == r,
    "!=": lambda l, r: l != r,
    "<": lambda l, r: l < r,
    "<=": lambda l, r: l <= r,
    ">": lambda l, r: l > r,
    ">=": lambda l, r: l >= r,
    "+": lambda l, r: l + r,
    "-": lambda l, r: l - r,
}


def build_polars_expr(ast: Expr, columns: set[str]) -> Any:
    """Convert an AST into a Polars expression.
    
    Args:
        ast: Parsed expression AST
        columns: Set of valid column names (for validation)
    
    Returns:
        A Polars expression that can be used in .select() or .filter().
    
    Raises:
        ExprParseError if the expression references unknown columns.
    """
    import polars as pl
    
    def build(node: Expr):
        if isinstance(node, FieldRef):
            if node.name not in columns:
                raise ExprParseError(f"Unknown column '{node.name}'")
            return pl.col(node.name)
        
        if isinstance(node, Literal):
            return pl.lit(node.value)
        
        if isinstance(node, BinaryOp):
            left = build(node.left)
            right = build(node.right)
            
            if node.op in _OP_MAP:
                return _OP_MAP[node.op](left, right)
            elif node.op == "and":
                return left & right
            elif node.op == "or":
                return left | right
            
            raise ExprParseError(f"Unsupported operator: {node.op}")
        
        if isinstance(node, UnaryOp):
            if node.op == "not":
                operand = build(node.operand)
                return ~operand
            raise ExprParseError(f"Unsupported unary operator: {node.op}")
        
        raise ExprParseError(f"Unknown node type: {type(node)}")
    
    return build(ast)