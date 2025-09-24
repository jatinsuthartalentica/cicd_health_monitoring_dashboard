#!/bin/bash

# Update the system
yum update -y

# Install Docker
amazon-linux-extras install docker -y
systemctl start docker
systemctl enable docker

# Add ec2-user to docker group
usermod -a -G docker ec2-user

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
ln -s /usr/local/bin/docker-compose /usr/bin/docker-compose

# Create directory for the application
mkdir -p /home/ec2-user/app
cd /home/ec2-user/app

# Create docker-compose.yml for the CI/CD Health Dashboard
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: cicddashboard
      POSTGRES_USER: cicdadmin
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    networks:
      - cicd-network

  api:
    build:
      context: ./backend
      dockerfile: Dockerfile
    environment:
      - DB_HOST=db
      - DB_PORT=5432
      - DB_NAME=cicddashboard
      - DB_USER=cicdadmin
      - DB_PASSWORD=${DB_PASSWORD}
    ports:
      - "8080:8080"
    depends_on:
      - db
    networks:
      - cicd-network

  web:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "3000:80"
    depends_on:
      - api
    networks:
      - cicd-network

  worker:
    build:
      context: ./worker
      dockerfile: Dockerfile
    environment:
      - DB_HOST=db
      - DB_PORT=5432
      - DB_NAME=cicddashboard
      - DB_USER=cicdadmin
      - DB_PASSWORD=${DB_PASSWORD}
    depends_on:
      - db
    networks:
      - cicd-network

volumes:
  postgres_data:

networks:
  cicd-network:
    driver: bridge
EOF

# Create a startup script
cat > start-app.sh << 'EOF'
#!/bin/bash

# Set database password
export DB_PASSWORD="CHANGE_THIS_PASSWORD"

# Navigate to app directory
cd /home/ec2-user/app

# Pull the latest code (you'll need to update this with your actual repo)
# git clone https://github.com/your-username/cicd-health-dashboard.git .

# Start the application
docker-compose up -d
EOF

chmod +x /home/ec2-user/app/start-app.sh

# Create systemd service for auto-start
cat > /etc/systemd/system/cicd-dashboard.service << 'EOF'
[Unit]
Description=CI/CD Health Dashboard
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/ec2-user/app
ExecStart=/home/ec2-user/app/start-app.sh
ExecStop=/usr/bin/docker-compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable cicd-dashboard.service

# Print completion message
echo "Docker installation and setup completed!"
echo "Please update the DB_PASSWORD in /home/ec2-user/app/start-app.sh"
echo "And clone your application code to /home/ec2-user/app"
