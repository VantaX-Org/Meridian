"""Email backend implementations for Meridian."""

from .microsoft_graph import create_graph_client, MicrosoftGraphEmailClient

__all__ = ["create_graph_client", "MicrosoftGraphEmailClient"]
