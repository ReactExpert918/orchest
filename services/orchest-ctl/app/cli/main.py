import logging
import sys
from enum import Enum
from typing import Optional

import typer

from app.cli import start as cli_start
from app.orchest import OrchestApp
from app.spec import get_container_config
from app.utils import echo


# TODO: utils.py
def init_logger(verbosity=0):
    """Initialize logger.

    The logging module is used to output to STDOUT for the CLI.

    Args:
        verbosity: The level of verbosity to use. Corresponds to the
        logging levels:
            3 DEBUG
            2 INFO
            1 WARNING
            0 ERROR

    """
    levels = [logging.ERROR, logging.WARNING, logging.INFO, logging.DEBUG]
    logging.basicConfig(level=levels[verbosity])

    root = logging.getLogger()
    if len(root.handlers) > 0:
        h = root.handlers[0]
        root.removeHandler(h)

    formatter = logging.Formatter("%(levelname)s: %(message)s")
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)
    root.addHandler(handler)


def _default(
    verbosity: int = typer.Option(
        0,
        "--verbose",
        "-v",
        count=True,
        show_default=False,
        max=3,
        clamp=True,
        help="Counter to set verbosity level, e.g. 'orchest -vvv start'",
    ),
):
    init_logger(verbosity=verbosity)


typer_app = typer.Typer(
    name="orchest",
    no_args_is_help=True,
    add_completion=False,
    help="""
    An IDE for Data Science.
    """,
    short_help="Orchest CLI",
    epilog="Run 'orchest COMMAND --help' for more information on a command.",
    callback=_default,
)

typer_app.add_typer(cli_start.typer_app, name="start")

app = OrchestApp()


class Language(str, Enum):
    python = "python"
    r = "r"
    julia = "julia"
    all = "all"
    none = "none"


def __entrypoint():
    typer_app()


@typer_app.command()
def version(
    ext: bool = typer.Option(
        False,
        "--ext",
        show_default=False,
        help="Get extensive version information.",
    ),
):
    """
    Get Orchest version.
    """
    app.version(ext=ext)


@typer_app.command()
def stop():
    """
    Shutdown Orchest.
    """
    app.stop()


@typer_app.command()
def status(
    ext: bool = typer.Option(
        False,
        "--ext",
        show_default=False,
        help="Get extensive status information.",
    ),
):
    """
    Get status of Orchest.

    Exit codes:

    - 0: Orchest is running and services are ready.

    - 1: Orchest is not running.

    - 2: Orchest is running, but some required service has shut down.

    - 3: Orchest is running, but some required service is not passing a
    health check.
    """
    app.status(ext=ext)


@typer_app.command()
def debug(
    compress: bool = typer.Option(
        False, "--compress", show_default=False, help="Compress the output directory."
    ),
    ext: bool = typer.Option(
        False,
        "--ext",
        show_default=False,
        help="Get extensive debug information.",
    ),
):
    """
    Create a debug dump.

    The dump is saved in the working directory as 'debug-dump'. When
    reporting a bug, it is best to: stop Orchest, start Orchest again,
    reproduce the bug, then use this command.

    The command does not need Orchest to be running when called, but
    will produce a less inclusive dump if that is not the case.

    Note: if Orchest was/has been running with --dev, then there is the
    possibility of some user data getting into the dump due to the log
    level being set to DEBUG.

    Note: running with the '--ext' flag could include sensitive user
    data.

    """
    app.debug(ext, compress)


@typer_app.command()
def install(
    language: Language = typer.Option(
        Language.python,
        "--lang",
        show_default=True,
        help="Language dependencies to install.",
    ),
    gpu: bool = typer.Option(
        False,
        show_default="--no-gpu",
        help=(
            "Whether to install GPU supported images corresponding"
            " to the given language dependencies."
        ),
    ),
):
    """Install Orchest.

    Installation might take some time depending on your network
    bandwidth.
    """
    app.install(language, gpu=gpu)


# TODO: make mode in Mode type. Although it is "web" here
@typer_app.command()
def update(
    mode: Optional[str] = typer.Option(None, hidden=True),
):
    """
    Update Orchest.

    Will always update the core dependencies of Orchest. Using the
    '--lang' flag you can specify the language dependencies to update,
    where '--lang=none' will only get you the services that Orchest
    uses.
    """
    app.update(mode=mode)


@typer_app.command()
def restart(
    # Support the old way of passing mode so that an old version of
    # Orchest does not break when updating.
    mode: str = typer.Option(
        "reg",
        help=(
            "Mode in which to start Orchest afterwards. This option is "
            "deprecated and will be removed in a future version. Use --dev "
            "instead of --mode=dev."
        ),
        hidden=True,
    ),
    port: Optional[int] = typer.Option(
        8000, help="The port the Orchest webserver will listen on."
    ),
    cloud: bool = typer.Option(
        False,
        show_default="--no-cloud",
        help=cli_start.__CLOUD_HELP_MESSAGE,
        hidden=True,
    ),
    dev: bool = typer.Option(
        False, show_default="--no-dev", help=cli_start.__DEV_HELP_MESSAGE
    ),
):
    """
    Restart Orchest.
    """

    dev = dev or (mode == "dev")
    container_config = get_container_config(port, cloud=cloud, dev=dev)
    app.restart(container_config)


@typer_app.command(hidden=True)
def updateserver(
    # Necessary to make it so that the update server restarts Orchest
    # with the correct settings.
    port: Optional[int] = typer.Option(
        8000, help="The port the Orchest webserver will listen on."
    ),
    cloud: bool = typer.Option(
        False,
        show_default="--no-cloud",
        help=cli_start.__CLOUD_HELP_MESSAGE,
        hidden=True,
    ),
    dev: bool = typer.Option(
        False, show_default="--no-dev", help=cli_start.__DEV_HELP_MESSAGE
    ),
):
    """
    Update Orchest through the update-server.
    """
    app._updateserver(port, cloud, dev)


@typer_app.command(hidden=True)
def adduser(
    username: str = typer.Argument(..., help="Name of the user to add."),
    set_token: bool = typer.Option(
        False, "--set-token", help="True if the token of the user is to be setup."
    ),
    is_admin: bool = typer.Option(
        False,
        show_default="--no-is-admin",
        help=(
            "If the newly created user should be an admin or not. An admin"
            " user cannot be deleted."
        ),
    ),
    non_interactive: bool = typer.Option(
        False, hidden=True, help="Use non interactive mode for password and token."
    ),
    non_interactive_password: Optional[str] = typer.Option(
        None, hidden=True, help="User password in non interactive mode."
    ),
    non_interactive_token: Optional[str] = typer.Option(
        None, hidden=True, help="User token in non interactive mode."
    ),
):
    """
    Add user to Orchest.
    """
    if non_interactive:
        password = non_interactive_password
        token = non_interactive_token
    else:
        if non_interactive_password:
            echo("Cannot use non_interactive_password in interactive mode.", err=True)
            raise typer.Exit(code=1)
        if non_interactive_token:
            echo("Cannot use non_interactive_token in interactive mode.", err=True)
            raise typer.Exit(code=1)

        password = typer.prompt("Password", hide_input=True, confirmation_prompt=True)
        if set_token:
            token = typer.prompt("Token", hide_input=True, confirmation_prompt=True)
        else:
            token = None

    if password is None:
        echo("Password must be specified.", err=True)
        raise typer.Exit(code=1)
    elif not password:
        echo("Password cannot be empty.", err=True)
        raise typer.Exit(code=1)
    if token is not None and not token:
        echo("Token cannot be empty.", err=True)
        raise typer.Exit(code=1)

    app.add_user(username, password, token, is_admin)
