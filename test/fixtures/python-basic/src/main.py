"""Main entry point for Python test fixture."""
from src.handler import handle_request
from src.dead import dead_function


def main():
    result = handle_request("hello")
    print(result)


def format_output(data: str, unused_param: int) -> str:
    """Has an unused parameter."""
    return f"[output] {data}"


if __name__ == "__main__":
    main()
