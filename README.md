<img src='docs/source/img/logo.png' width="300px" />
<br/>

[Website](https://www.orchest.io) — 
[Docs](https://orchest.readthedocs.io/en/latest/) — 
[Quickstart](https://orchest.readthedocs.io/en/latest/quickstart.html) -
[Slack](https://join.slack.com/t/orchest/shared_invite/zt-g6wooj3r-6XI8TCWJrXvUnXKdIKU_8w)

-----
<img alt="Version badge 0.1.0"
src="https://img.shields.io/badge/version-0.1.0-blue" />  <a
href="https://community.orchest.io/"><img alt="Orchest Discourse chat"
src="https://img.shields.io/discourse/status?server=https%3A%2F%2Fcommunity.orchest.io"
/></a>

Orchest is a web based data science platform that works on top of your filesystem allowing you to use your
editor of choice. With Orchest you get to focus on visually building and iterating on your
pipeline ideas. Under the hood Orchest runs a collection of containers to provide a scalable platform that can run on your laptop as well as on a large scale cloud cluster.

Orchest lets you
* Interactively build data science pipelines through its visual interface.
* Automatically run your pipelines in parallel.
* Develop your code in your favorite editor. Everything is filesystem based.
* Tag the notebooks cells you want to skip when running a pipeline. Perfect for prototyping as you do not 
  have to maintain a perfectly clean notebook.


## Table of contents
- [Table of contents](#table-of-contents)
- [Installation](#installation)
- [Quickstart](#quickstart)
  - [Build your pipeline.](#build-your-pipeline)
  - [Write your code.](#write-your-code)
  - [Run your pipeline and see the results come in.](#run-your-pipeline-and-see-the-results-come-in)
- [Contributing](#contributing)
- [We love your feedback](#we-love-your-feedback)


## Installation
Requirements
* Docker (tested on 19.03.9)

Linux/macOS
```bash
git clone https://github.com/orchest/orchest.git
cd orchest
./orchest.sh start
```

Windows
```bash
git clone https://github.com/orchest/orchest.git
cd orchest
orchest.bat start
```

**Note!** On Windows, make sure to give Docker permission to mount the directory in which
you cloned Orchest. For more details check the [Windows Docker documentation](https://docs.docker.com/docker-for-windows/#resources) (_Docker settings_ > _Resources_ > _File sharing_ > Add directory that contains Orchest).


## Quickstart
Please refer to our docs for a more comprehensive 
[quickstart](https://orchest.readthedocs.io/en/latest/quickstart.html) tutorial.

### Build your pipeline.
*Each pipeline step executes a file (.ipynb, .py, .R, .sh) in a containerized environment.*

![clip-1-cropped](https://user-images.githubusercontent.com/1309307/82610388-8ffc7580-9bbe-11ea-8886-d045ff6b76d0.gif)

### Write your code.
*Iteratively edit and run your code for each pipeline step with an interactive JupyterLab session.*

![clip-2-cropped](https://user-images.githubusercontent.com/1309307/82610397-94c12980-9bbe-11ea-8e16-eb686d0cfc75.gif)

### Run your pipeline and see the results come in.
*Outputs (both `stdout` and `stderr`) are directly viewable and stored on disk.*

![clip-3-cropped](https://user-images.githubusercontent.com/1309307/82610401-95f25680-9bbe-11ea-9de3-b4dc44a1e01b.gif)


## Contributing
Contributions are more than welcome! Please see our 
[contributer guides](https://orchest.readthedocs.io/en/latest/development/contributer_guides.html)
for more details.


## We love your feedback
We would love to hear what you think and potentially add features based on your ideas. Come chat
with us at our [Community forum](https://community.orchest.io/).
