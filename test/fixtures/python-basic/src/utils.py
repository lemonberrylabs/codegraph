"""Utility functions."""


def validate(input_str: str) -> bool:
    return len(input_str) > 0


def sanitize(input_str: str, encoding: str) -> str:
    """encoding parameter is unused."""
    return input_str.strip()
