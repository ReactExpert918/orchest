.. _orchest sdk:

Orchest SDK
===========

.. note::
   💡 The Orchest SDK comes pre-installed when using Orchest.

Python
------

Data passing
~~~~~~~~~~~~

Please refer to the dedicated section on :ref:`data passing <data passing>`.

.. _sdk-quickstart-parameters:

Parameters
~~~~~~~~~~
.. code-block:: python

   import orchest

   # Get the parameters of the current step and the pipeline.
   fruit = orchest.get_step_param("fruit") # e.g. "apple"
   vegetable = orchest.get_pipeline_param("vegetable") # e.g. "carrot"

   # Update the step parameter. The updated parameter will be
   # visible in the GUI, in the properties pane of the step.
   fruit = "kiwi"
   orchest.update_step_param("fruit", fruit)

.. note::
   Parameters are at the core of :ref:`jobs <jobs>`, giving a handle to try out different modeling
   ideas based on a set of variable inputs.

R
-
.. tip::
   👉 Import the `example project
   <https://github.com/orchest-examples/orchest-pipeline-r-python-mix>`_ showcasing **R** straight
   in Orchest (:ref:`how to import a project <how to import a project>`).

The Orchest SDK in **R** works through the `reticulate <https://rstudio.github.io/reticulate/>`_
package. To explain its usage, an example project is provided below.

First, create an Orchest environment which uses the ``orchest/base-kernel-r`` base image (you can
find more details :ref:`here <environments>`). Next you want to install ``reticulate`` and configure
access to Python and the Orchest SDK.  You can do so by having a script (let's say ``Install.r``) in
your project with the following content:

.. code-block:: r

   install.packages("reticulate", repos = "http://cran.us.r-project.org")
   library(reticulate)

   # Dynamically find system Python
   python_path <- system("which python", intern=TRUE)
   use_python(python_path)

   # Pre compile orchest deps
   orchest <- import("orchest")

   print(orchest)

and having the environment set-up script perform ``Rscript Install.r``.  You will then be able to
access the Orchest SDK through R **in every step that makes use of this environment** . To do data
passing, for example, you would do the following:

.. code-block:: r

 library(reticulate);
 python_path <- system("which python", intern=TRUE);
 use_python(python_path);
 orchest <- import("orchest");
 orchest$transfer$output(2, name="Test");

In a child step you will be able to retrieve the output:

.. code-block:: r

 library(reticulate);
 python_path <- system("which python", intern=TRUE);
 use_python(python_path);
 orchest <- import("orchest")
 step_inputs = orchest$transfer$get_inputs()
 step_inputs$Test

API reference
-------------

.. _api transfer:

orchest.transfer
~~~~~~~~~~~~~~~~

.. automodule:: orchest.transfer
    :members:


orchest.parameters
~~~~~~~~~~~~~~~~~~

.. automodule:: orchest.parameters
    :members:


orchest.services
~~~~~~~~~~~~~~~~~~

.. automodule:: orchest.services
    :members:
