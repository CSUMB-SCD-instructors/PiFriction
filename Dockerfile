FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    fd-find \
    git \
    jq \
    less \
    nano \
    openssh-client \
    python3 \
    python3-pip \
    python3-venv \
    ripgrep \
    tree \
    unzip \
    zip \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent

WORKDIR /opt/pifriction
COPY package.json README.md ./
COPY extensions ./extensions
RUN npm install --omit=dev
COPY docker-entrypoint.sh /usr/local/bin/pifriction-entrypoint
RUN chmod +x /usr/local/bin/pifriction-entrypoint

RUN mkdir -p /data /home/pifriction/.pi/agent && chmod -R 777 /data /home/pifriction

ENV HOME=/home/pifriction
WORKDIR /data

ENTRYPOINT ["pifriction-entrypoint"]
CMD []
