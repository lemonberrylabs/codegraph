"""Handler module."""
from src.utils import validate


def handle_request(input_str: str) -> str:
    if not validate(input_str):
        return "invalid"
    return process_data(input_str)


def process_data(data: str) -> str:
    return data.upper()
