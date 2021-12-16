How to...
=========

Pass data between pipeline steps
--------------------------------
Please refer to the dedicated section on :ref:`data passing <data passing>`.

Install new packages
--------------------
.. tip::
    👉 Would you rather watch a short video tutorial? Check it our here: `installing additional
    packages <https://app.tella.tv/story/cknr8owf4000308kzalsk11a5>`_.

To install new packages, you should make use of :ref:`environments <environments>`. Simply build a
new environment that contains your package and select it inside the pipeline editor. Installing
packages is done using well known commands such as ``pip install`` and ``sudo apt-get install``.

.. note::
   💡 When updating an existing environment, the new environment will automatically be used inside
   the visual editor (and for your :ref:`interactive pipeline runs <interactive pipeline run>`).
   However, the JupyterLab kernel needs to be restarted if it was already running.

What not to do
~~~~~~~~~~~~~~
Do **not** install new packages by running bash commands inside the Notebooks. This will require the
packages to be installed every time you do a pipeline run, since the state of the kernel environment
is ephemeral.

Use ``git`` inside Orchest
--------------------------
Please refer to the dedicated section on :ref:`using git inside Orchest <git inside Orchest>`.

.. _how to import a project:

Import a project
----------------
Check out our video: `importing a project
<https://www.tella.tv/video/cknr7of9c000409jr5gx4efjy/view>`_.

Share code between steps
------------------------
.. note::
   💡 This approach also works to share code between pipelines.

There are multiple answers to this question. One being that you can make that code into a package
which you can then install in your environment, just like other packages such as ``numpy``. Of
course the development cycle would be highly reduced with this approach and so an alternative would
be to add the files to the project directory directly and import them in your scripts.

For example, you could create a ``utils.py`` file in your project directory and use its functions
from within your scripts by:

.. code-block:: python

   import utils

   utils.transform(...)

Minimize Orchest's disk size
----------------------------
To keep Orchest's disk footprint to a minimal you can use the following best practices:

* Are you persisting data to disk? Then write it to the ``/data`` directory instead of the project
  directory. :ref:`Jobs <jobs>` create a snapshot (for reproducibility reasons) of your project
  directory and would copy data in your project directory for every pipeline run, consuming large
  amounts of storage. The smaller the size of your project directory, the smaller the size of your
  jobs.
* Do you have many pipeline runs as part of jobs? You can periodically delete old pipeline runs of
  your jobs. Currently you will have to do this through the *File manager* but in the future (see
  `#601 <https://github.com/orchest/orchest/issues/601>`_) this will become possible through the UI
  directly.

Use a GPU in Orchest
--------------------
Make sure you have read the instructions in the :ref:`GPU support section <installation gpu
support>` of the installation process. Next, you need to create an :ref:`environment <environments>`
that uses the ``orchest/base-kernel-py-gpu`` (or your custom image with GPU capabilities) as its
base image and tick the *GPU support* checkbox.

Now you can use the GPU from within your environments.

Use the Orchest CLI
-------------------
Below you will find the most important CLI commands that you need to know (you can also get all this
information by running ``./orchest --help``:

.. code-block:: sh

   # Start Orchest (on port 8000)
   ./orchest start

   # Start Orchest and forward its port to port 80 on the host.
   ./orchest start --port=80

   # Stop Orchest (shuts down Orchest completely).
   ./orchest stop

   # Install Orchest (check out the dedicated `Installation` guide in
   # the `Getting started` section).
   ./orchest install

   # Update Orchest to a newer version (NOTE: this can also be done
   # through the settings in the UI).
   ./orchest update

   # Get extensive version information. Useful to see whether the
   # installation was successful.
   ./orchest version --ext

   # Create a one-off job for a pipeline through the CLI.
   ./orchest run --job='my-job' --project=quickstart --pipeline='california-housing'


Use Orchest shortcuts like a pro
--------------------------------

Command palette
~~~~~~~~~~~~~~~
.. list-table::
   :widths: 25 25
   :header-rows: 1
   :align: left

   * - Key(s)
     - Action

   * - :kbd:`Control`/:kbd:`Command` + :kbd:`K`
     - Open command palette

   * - :kbd:`↑`/:kbd:`↓`
     - Navigate command palette commands

   * - :kbd:`PageUp`/:kbd:`PageDown`
     - Navigate command palette commands

   * - :kbd:`Escape`
     - Dismiss command palette

Pipeline editor
~~~~~~~~~~~~~~~
.. list-table::
   :widths: 25 25
   :header-rows: 1
   :align: left

   * - Key(s)
     - Action

   * - :kbd:`Space` + click + drag
     - Pan canvas*

   * - :kbd:`Ctrl` + click
     - Select multiple steps

   * - :kbd:`Ctrl` + :kbd:`A`
     - Select all steps*

   * - :kbd:`Ctrl` + :kbd:`Enter`
     - Run selected steps*

   * - :kbd:`H`
     - Center view and reset zoom

   * - :kbd:`Escape`
     - Deselect steps

   * - :kbd:`Delete`/:kbd:`Backspace`
     - Delete selected step(s)

   * - Double click a step
     - Open file in JupyterLab

\* Requires mouse to hover the canvas

.. _skip notebook cells:

Skip notebook cells
-------------------
Notebooks facilitate an experimental workflow, meaning that there will be cells that should not be
run when executing the notebook (from top to bottom). Since :ref:`pipeline runs <pipeline run>`
require your notebooks to be executable, Orchest provides an (pre-installed JupyterLab) extension
to skip those cells.

To skip a cell during pipeline runs:

1. Open JupyterLab.
2. Go to the *Property Inspector*, this is the icon with the two gears all the way at the right.
3. Select the cell you want to skip and give it a tag of: *skip*.

The cells with the *skip* tag are still runnable through JupyterLab, but when executing these
notebooks as part of pipelines in Orchest they will not be run.

.. _self-host orchest:

Self-host Orchest
-----------------
Running Orchest on a cloud hosted VM (such as EC2) does not require a special installation. Simply
follow the :ref:`regular installation process <regular installation>`.

To enable SSL you first need to get the SSL certificates for your domain and put the certificates in
the correct place so that Orchest recognizes them. This can be done using a convenience script:

.. code-block:: sh

    scripts/letsencrypt-nginx.sh <domain> <email>

Make sure to start Orchest on port ``80`` so that HTTP requests can automatically be upgraded to
HTTPS:

.. code-block:: bash

   ./orchest start --port=80

.. tip::
   👉 Refer to ``AUTH_ENABLED`` in the :ref:`Orchest settings section <orchest settings>` to enable
   the authentication.
