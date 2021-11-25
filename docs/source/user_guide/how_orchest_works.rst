.. _how orchest works:

How Orchest works
=================

A pipeline in Orchest can be thought of as a graph, where the nodes are executable files that
execute within their own isolated environment (powered by containerization), and the edges define
the execution order and the way the data flows. All build in our visual pipeline editor.

.. note::
   Global configurations are stored at ``~/.config/orchest/config.json``, for possible configuration
   values see :ref:`configuration <configuration>`.

Orchest is a fully containerized application and its runtime can be managed through the ``orchest``
shell script. In the script you can see that the Docker socket ``/var/run/docker.sock`` is mounted,
which Orchest requires in order order to dynamically spawn Docker containers when running pipelines.

Orchest is powered by your filesystem, there is no hidden magic. Upon launching, Orchest will mount
the content of the ``orchest/userdir/`` directory, where ``orchest/`` is the install directory from
GitHub, in the Docker containers. Giving you access to your scripts from within Orchest, but also
allowing you to structure and edit the files with any other editor such as VS Code!

.. caution::
   The ``userdir/`` directory not only contains your files and scripts, it also contains the state
   (inside the ``userdir/.orchest/`` directory) that Orchest needs to run. Touching the state can
   result in, for example, losing job entries causing them to no longer show up in the UI.

The mental model in Orchest is centered around *Projects*. Within each project you get to create
multiple :ref:`pipelines <pipeline>` through the Orchest UI, and every pipeline consists of
:ref:`pipeline steps <pipeline step>` that point to your scripts. Let's take a look at the
following directory structure of a project:

.. code-block:: bash

    myproject
        ├── .orchest
        │   ├── pipelines/
        │   └── environments/
        ├── pipeline.orchest
        ├── prep.ipynb
        └── training.py

.. note::
   Again Orchest creates a ``.orchest/`` directory to store state. In the ``.orchest/pipelines/``
   directory the passed data between steps is stored (per pipeline in ``data/``), if disk based data
   passing is used instead of (the default) memory data passing, see :ref:`data passing <data
   passing>`. Per pipeline (inside ``.orchest/pipelines/``) there is also a ``logs/`` directory
   containing the STDOUT of the scripts, the STDOUT can be inspected through the Orchest UI.

.. tip::
   You should not put large files inside your project, instead, you should write data to the special
   ``/data`` directory. The ``/data`` directory is actually the mounted ``userdir/data/`` directory,
   and is shared between projects.  :ref:`Jobs <jobs>` creates snapshots of the project directory
   (for reproducibility reasons) and therefore would copy all the data.

The :ref:`pipeline definition <pipeline definition>` file ``pipeline.orchest`` in the directory
structure above defines the structure of the pipeline. For example:

.. image:: ../img/pipeline-orientation.png
  :width: 400
  :alt: Pipeline defined as: prep.ipynb --> training.py
  :align: center

As you can see the pipeline steps point to the corresponding files: ``prep.ipynb`` and
``training.py``. These files are run inside their own isolated environments (as defined in
``.orchest/environments/``) using containerization.  In order to install additional packages or to
easily change the Docker image, see :ref:`environments <environments>`.

Concepts
--------
At Orchest we believe that Jupyter Notebooks thank their popularity to their interactive nature. It
is great to get immediate feedback and actively inspect your results without having to run the
entire script.

To facilitate a similar workflow within Orchest both JupyterLab and :ref:`interactive pipeline runs
<interactive pipeline run>` get to directly change your notebook files. Lets explain this with an
example. Assume your pipeline is just a single ``.ipynb`` file (run inside its own environment) with
the following code:

.. code-block:: python

   print("Hello World!")

If you now, without having executed this cell in JupyterLab, go to the pipeline editor, select the
step and press *Run selected steps* then you will see in JupyterLab that the cell has outputted
``"Hello World!"`` without having run it in JupyterLab.

.. note::
   Even though both interactive pipeline runs and JupyterLab change your files, they do not share
   the same kernel! They do of course share the same environment.

.. tip::
   Make sure to save your notebooks before running an interactive pipeline run, otherwise JupyterLab
   will prompt you with a "File Changed" pop-up whether you want to "Overwrite" or "Revert" on the
   next save. "Overwrite" would let you keep the changes, however, it would then overwrite the
   changes made by the interactive run.
