#!/bin/bash
set -e

# Get the user and group of the "orchest" shell script as this is most
# likely also the user that should own the files in the repository.
FILE_USER=$(ls -n /orchest-host/orchest | awk '{print $3}')
FILE_GROUP=$(ls -n /orchest-host/orchest | awk '{print $4}')

GIT_USERNAME_SET=false
if [ -z "$(git config user.name)" ] ; then
  GIT_USERNAME_SET=true
  # a name is required for pull/fetch operations
  git config user.name "John Doe"
fi
GIT_EMAIL_SET=false
if [ -z "$(git config user.email)" ] ; then
  GIT_EMAIL_SET=true
  # an email is required for pull/fetch operations
  git config user.email "johndoe@example.org"
fi

# Explicitely use HTTPS so that we do not get the error:
# "error: cannot run ssh: No such file or directory"
# It is caused when the remote "origin" uses SSH.
git pull https://github.com/orchest/orchest.git --rebase
# explicitly fetch tags
git fetch https://github.com/orchest/orchest.git --tags

# Change the user and group of all the files in the repository, except
# for the userdir.
chown -R $FILE_USER:$FILE_GROUP $(ls -I userdir /orchest-host)

# Cleanup git username/email
if [ "$GIT_USERNAME_SET" = true ] ; then
  git config --unset user.name
fi
if [ "$GIT_EMAIL_SET" = true ] ; then
  git config --unset user.email
fi