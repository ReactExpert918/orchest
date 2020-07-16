#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
IMGS=()
SDK_BRANCH="master"
NO_CACHE=false
VERBOSE=false

# Read flags.
while getopts ":s:i:n:v" opt; do
  case $opt in
    s)
      SDK_BRANCH=$OPTARG
      ;;
    i)
      IMGS+=($OPTARG)
      ;;
    n)
      NO_CACHE=true
      ;;
    v)
      VERBOSE=true
      ;;
    \?)
      echo "Invalid option: -$OPTARG" >&2
      ;;
  esac
done

# If no images are specified, we want to build all of them.
if [ ${#IMGS[@]} -eq 0 ]; then
    BUILD_ALL=true
    IMGS+=("All images")
else
    BUILD_ALL=false
fi

run_build () {

    echo [Building] $IMG

    if $VERBOSE; then
        "${build[@]}"
    else
        output=$("${build[@]}" 2>&1)
    fi

    if [ $? = 0 ]; then
        echo [Building] $IMG succeeded.
    else
        echo [Building] $IMG failed.
        echo "$output"
    fi
}

# Build the images.
for IMG in ${IMGS[@]}
do
    unset build

    # JupyterLab server
    if $BUILD_ALL || [ $IMG == "jupyter-server" ]; then

        build=(docker build \
            -t orchestsoftware/jupyter-server \
            --no-cache=$NO_CACHE \
            $DIR/../orchest/jupyter-server)
        
    fi

    if $BUILD_ALL || [ $IMG == "celery-worker" ]; then
        
        build=(docker build \
            -t orchestsoftware/celery-worker \
            -f $DIR/../orchest/orchest-api/Dockerfile_celery \
            --no-cache=$NO_CACHE \
            $DIR/../orchest/orchest-api)

    fi

    # augmented images
    # install orchest-sdk
    if $BUILD_ALL || [ $IMG == "scipy-notebook-augmented" ]; then
        build=(docker build \
            -t orchestsoftware/scipy-notebook-augmented \
            --build-arg sdk_branch=$SDK_BRANCH \
            --no-cache=$NO_CACHE \
            $DIR/../orchest/custom-images/scipy-notebook-augmented)
    fi

    if $BUILD_ALL || [ $IMG == "r-notebook-augmented" ]; then
        build=(docker build \
            -t orchestsoftware/r-notebook-augmented \
            --build-arg sdk_branch=$SDK_BRANCH \
            --no-cache=$NO_CACHE \
            $DIR/../orchest/custom-images/r-notebook-augmented)
    fi

    # runnable images
    if $BUILD_ALL || [ $IMG == "scipy-notebook-runnable" ]; then
        build=(docker build -t orchestsoftware/scipy-notebook-runnable \
            -f $DIR/../orchest/custom-images/runnable-images/scipy-notebook-runnable/Dockerfile \
            --no-cache=$NO_CACHE \
            $DIR/../orchest/custom-images/runnable-images)
    fi

    if $BUILD_ALL || [ $IMG == "r-notebook-runnable" ]; then
        build=(docker build -t orchestsoftware/r-notebook-runnable \
            -f $DIR/../orchest/custom-images/runnable-images/r-notebook-runnable/Dockerfile \
            --no-cache=$NO_CACHE \
            $DIR/../orchest/custom-images/runnable-images)
    fi

    # custom enterprise gateway kernel images
    # install orchest-sdk
    if $BUILD_ALL || [ $IMG == "custom-base-kernel-py" ]; then
        build=(docker build \
            -t orchestsoftware/custom-base-kernel-py \
            -f $DIR/../orchest/custom-images/custom-base-kernel-py/Dockerfile \
            --build-arg sdk_branch=$SDK_BRANCH \
            --no-cache=$NO_CACHE \
            $DIR/../orchest/custom-images/scipy-notebook-augmented)
    fi

    if $BUILD_ALL || [ $IMG == "custom-base-kernel-r" ]; then
        build=(docker build \
            -t orchestsoftware/custom-base-kernel-r \
            -f $DIR/../orchest/custom-images/custom-base-kernel-r/Dockerfile \
            --build-arg sdk_branch=$SDK_BRANCH \
            --no-cache=$NO_CACHE \
            $DIR/../orchest/custom-images/r-notebook-augmented)
    fi

    # application images

    if $BUILD_ALL || [ $IMG == "orchest-api" ]; then
        build=(docker build \
            -t orchestsoftware/orchest-api \
            --no-cache=$NO_CACHE \
            $DIR/../orchest/orchest-api/)
    fi

    if $BUILD_ALL || [ $IMG == "orchest-ctl" ]; then
        build=(docker build \
            -t orchestsoftware/orchest-ctl \
            --no-cache=$NO_CACHE \
            $DIR/../orchest/orchest-ctl/)
    fi

    if $BUILD_ALL || [ $IMG == "orchest-webserver" ]; then
        build=(docker build \
            -t orchestsoftware/orchest-webserver \
            --no-cache=$NO_CACHE \
            $DIR/../orchest/orchest-webserver/)
    fi

    if $BUILD_ALL || [ $IMG == "nginx-proxy" ]; then
        build=(docker build \
            -t orchestsoftware/nginx-proxy \
            --no-cache=$NO_CACHE \
            $DIR/../orchest/nginx-proxy/)
    fi

    # installs orchest-sdk
    if $BUILD_ALL || [ $IMG == "memory-server" ]; then
        build=(docker build \
            -t orchestsoftware/memory-server \
            --build-arg sdk_branch=$SDK_BRANCH \
            --no-cache=$NO_CACHE \
            $DIR/../orchest/memory-server/)
    fi

    if [ -n "$build" ]; then
        run_build
    fi

done
