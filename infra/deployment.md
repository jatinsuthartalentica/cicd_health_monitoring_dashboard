# CI/CD Pipeline Health Dashboard - Cloud Deployment Guide

This guide provides step-by-step instructions for deploying your CI/CD Pipeline Health Dashboard to AWS using Terraform.

## Prerequisites

Before you begin, ensure you have the following:

1. **AWS Account**: An active AWS account with appropriate permissions
2. **AWS CLI**: Installed and configured with your AWS credentials
3. **Terraform**: Version 1.0 or later installed
4. **SSH Key Pair**: An SSH key pair for EC2 access
5. **Git Repository**: Your application code in a Git repository

## Infrastructure Overview

The Terraform configuration provisions the following resources:

- **VPC** with public and private subnets
- **Internet Gateway** and **NAT Gateway** for internet access
- **Security Groups** for web servers and database
- **RDS PostgreSQL** database instance
- **EC2 Instance** with Docker installed
- **Elastic IP** for stable public IP address

## Step 1: Prepare Your Environment

### 1.1 Clone Your Repository

```bash
git clone <your-repository-url>
cd <your-repository-directory>
```

### 1.2 Configure AWS CLI

```bash
aws configure
```

Enter your AWS Access Key ID, Secret Access Key, default region, and output format.

### 1.3 Create SSH Key Pair

If you don't have an SSH key pair, create one:

```bash
ssh-keygen -t rsa -b 2048 -f ~/.ssh/id_rsa
```

Upload the public key to AWS:

```bash
aws ec2 import-key-pair --key-name cicd-dashboard-key --public-key-material file://~/.ssh/id_rsa.pub
```

### 1.4 Configure Terraform Variables

Create a `terraform.tfvars` file in the `infra` directory:

```hcl
aws_region = "us-east-1"
project_name = "cicd-health-dashboard"
environment = "prod"
db_password = "your-secure-password-here"
allowed_ssh_cidr = "YOUR.IP.ADDRESS/32"  # Replace with your IP for security
```

## Step 2: Deploy Infrastructure

### 2.1 Navigate to Infrastructure Directory

```bash
cd infra
```

### 2.2 Initialize Terraform

```bash
terraform init
```

### 2.3 Plan Deployment

```bash
terraform plan
```

Review the plan output to ensure all resources are configured correctly.

### 2.4 Deploy Infrastructure

```bash
terraform apply
```

Type `yes` when prompted to confirm the deployment.

### 2.5 Record Important Outputs

After deployment, Terraform will display important outputs including:

- **EC2 Public IP**: The public IP address of your web server
- **RDS Endpoint**: The database endpoint for your application
- **Database Name**: The name of your PostgreSQL database

Save these values for the next steps.

## Step 3: Deploy Your Application

### 3.1 Connect to EC2 Instance

```bash
ssh -i ~/.ssh/id_rsa ec2-user@<EC2_PUBLIC_IP>
```

### 3.2 Update Database Configuration

Edit the startup script:

```bash
nano /home/ec2-user/app/start-app.sh
```

Update the `DB_PASSWORD` variable with your actual database password.

### 3.3 Clone Your Application Code

```bash
cd /home/ec2-user/app
git clone <your-repository-url> .
```

### 3.4 Update Docker Compose Configuration

Edit the `docker-compose.yml` file to update database connection details:

```bash
nano docker-compose.yml
```

Update the environment variables with your actual RDS endpoint and credentials.

### 3.5 Start the Application

```bash
# Set the database password
export DB_PASSWORD="your-actual-password"

# Start the application
docker-compose up -d
```

### 3.6 Verify Deployment

Check if all services are running:

```bash
docker-compose ps
```

## Step 4: Access Your Dashboard

### 4.1 Web Interface

Open your browser and navigate to:

```
http://<EC2_PUBLIC_IP>:3000
```

### 4.2 API Endpoints

Your API will be available at:

```
http://<EC2_PUBLIC_IP>:8080
```

## Step 5: Monitoring and Maintenance

### 5.1 Check Application Logs

```bash
# Connect via SSH
ssh -i ~/.ssh/id_rsa ec2-user@<EC2_PUBLIC_IP>

# Check application logs
cd /home/ec2-user/app
docker-compose logs -f
```

### 5.2 Database Connection

To connect to your database directly:

```bash
psql -h <RDS_ENDPOINT> -p 5432 -U cicdadmin -d cicddashboard
```

### 5.3 Update Application

To update your application:

```bash
cd /home/ec2-user/app
git pull origin main
docker-compose down
docker-compose up -d --build
```

## Step 6: Cleanup (Optional)

To destroy all resources when you're done:

```bash
cd infra
terraform destroy
```

Type `yes` when prompted to confirm destruction.

## Security Considerations

1. **SSH Access**: The security group allows SSH from `0.0.0.0/0` by default. Update the `allowed_ssh_cidr` variable to restrict access to your IP only.

2. **Database Password**: Use a strong, unique password for your database.

3. **HTTPS**: Consider setting up SSL/TLS certificates for production use.

4. **Firewall**: Review and update security group rules based on your specific requirements.

## Troubleshooting

### Common Issues

1. **Permission Denied**: Ensure your AWS credentials have sufficient permissions for EC2, RDS, and VPC operations.

2. **Instance Not Accessible**: Check that the security groups allow traffic on the required ports.

3. **Database Connection Issues**: Verify that the EC2 instance is in the same VPC as the RDS instance and that the database security group allows connections from the web security group.

4. **Docker Issues**: If Docker fails to start, check the system logs: `journalctl -u docker.service`

### Getting Help

If you encounter issues:

1. Check the Terraform output for error messages
2. Review AWS CloudWatch logs for the EC2 instance
3. Verify your AWS quotas and limits
4. Check the AWS documentation for the specific services you're using

## Cost Estimation

The following is a rough monthly cost estimate for this infrastructure:

- **EC2 t3.medium**: ~$30/month
- **RDS t3.micro**: ~$15/month
- **Elastic IP**: ~$5/month
- **NAT Gateway**: ~$35/month
- **Data Transfer**: Variable based on usage

**Total Estimated Cost**: ~$85/month

Note: Prices may vary based on region and usage. Check the AWS Pricing Calculator for accurate estimates.

## Next Steps

1. **Monitoring**: Set up CloudWatch monitoring and alerts
2. **Backup**: Configure automated backups for your database
3. **Scaling**: Consider using Auto Scaling Groups for production workloads
4. **CDN**: Implement CloudFront for faster content delivery
5. **SSL**: Add SSL certificates using AWS Certificate Manager

Congratulations! Your CI/CD Pipeline Health Dashboard is now deployed to the cloud! 🎉
