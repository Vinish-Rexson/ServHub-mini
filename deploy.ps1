################################################################################
# ServHub-Mini — Full Automated Deployment Script
# Run from: C:\Projects\CCL\ServHub-mini
#
# FIRST RUN:  .\deploy.ps1
# REDEPLOY:   .\deploy.ps1 -Resume   (skips infra, rebuilds images + dashboard only)
#
# MANUAL STEPS REMAINING AFTER THIS SCRIPT:
#   1. Cloudflare: Add two A records (app + api) pointing to $EC2_IP
#   2. Supabase: Update Site URL and Redirect URL to your domain
#   3. GitHub OAuth App: Update Homepage URL and Callback URL
################################################################################
param(
    [switch]$Resume   # Skip infra creation, just rebuild and redeploy
)

# ── CONFIGURATION ─────────────────────────────────────────────────────────────
$AWS_REGION      = "ap-south-1"
$AWS_ACCOUNT     = "421454275395"
$APP_DOMAIN      = "servhub.4istudios.in"      # Dashboard
$API_DOMAIN      = "api-servhub.4istudios.in"  # API
$DOMAIN          = "4istudios.in"              # root domain

$KEY_NAME        = "servhub-key"
$KEY_PATH        = "$HOME\Downloads\$KEY_NAME.pem"
$SG_NAME         = "servhub-sg"
$INSTANCE_NAME   = "servhub-prod"
$INSTANCE_TYPE   = "t3.small"
$AMI_ID          = "ami-0f58b397bc5c1f2e8"   # Ubuntu 24.04 LTS ap-south-1

$ECR_API         = "servhub-api"
$ECR_BUILDER     = "servhub-builder"
$ECR_BASE        = "$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"

$S3_BUCKET       = "servhub-deployments-prod"

$CW_LOG_API      = "/servhub/api"
$CW_LOG_BUILDER  = "/servhub/builder"

# ── HELPERS ───────────────────────────────────────────────────────────────────
function Log($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)  { Write-Host "    OK: $msg" -ForegroundColor Green }
function Err($msg) { Write-Host "    ERR: $msg" -ForegroundColor Red; exit 1 }

################################################################################
# PHASE 1 — AWS INFRASTRUCTURE (skipped with -Resume)
################################################################################
if (-not $Resume) {

# ── 1a. Key Pair ──────────────────────────────────────────────────────────────
Log "Creating EC2 key pair: $KEY_NAME"
$existingKey = aws ec2 describe-key-pairs --key-names $KEY_NAME --region $AWS_REGION 2>$null
if ($existingKey) {
    Ok "Key pair already exists, skipping"
} else {
    aws ec2 create-key-pair `
        --key-name $KEY_NAME `
        --query "KeyMaterial" `
        --output text `
        --region $AWS_REGION | Out-File -FilePath $KEY_PATH -Encoding ascii -NoNewline
    # Fix permissions so SSH accepts it
    icacls $KEY_PATH /inheritance:r /grant:r "${env:USERNAME}:R" | Out-Null
    Ok "Key saved to $KEY_PATH"
}

# ── 1b. Security Group ────────────────────────────────────────────────────────
Log "Creating security group: $SG_NAME"
$existingSG = aws ec2 describe-security-groups `
    --filters "Name=group-name,Values=$SG_NAME" `
    --query "SecurityGroups[0].GroupId" `
    --output text `
    --region $AWS_REGION 2>$null

if ($existingSG -and $existingSG -ne "None") {
    $SG_ID = $existingSG
    Ok "Security group already exists: $SG_ID"
} else {
    $SG_ID = aws ec2 create-security-group `
        --group-name $SG_NAME `
        --description "ServHub production security group" `
        --query "GroupId" `
        --output text `
        --region $AWS_REGION
    Ok "Created security group: $SG_ID"

    # Get your current public IP for SSH access
    $MY_IP = (Invoke-RestMethod -Uri "https://checkip.amazonaws.com").Trim()

    # SSH — your IP only
    aws ec2 authorize-security-group-ingress `
        --group-id $SG_ID `
        --protocol tcp --port 22 `
        --cidr "$MY_IP/32" `
        --region $AWS_REGION | Out-Null

    # HTTP — open (Cloudflare needs this)
    aws ec2 authorize-security-group-ingress `
        --group-id $SG_ID `
        --protocol tcp --port 80 `
        --cidr "0.0.0.0/0" `
        --region $AWS_REGION | Out-Null

    # HTTPS — open (optional)
    aws ec2 authorize-security-group-ingress `
        --group-id $SG_ID `
        --protocol tcp --port 443 `
        --cidr "0.0.0.0/0" `
        --region $AWS_REGION | Out-Null

    Ok "Inbound rules configured (SSH from $MY_IP, HTTP/HTTPS from everywhere)"
}

# ── 1c. Launch EC2 Instance ───────────────────────────────────────────────────
Log "Checking for existing EC2 instance: $INSTANCE_NAME"
$INSTANCE_ID = aws ec2 describe-instances `
    --filters "Name=tag:Name,Values=$INSTANCE_NAME" "Name=instance-state-name,Values=running,pending,stopped" `
    --query "Reservations[0].Instances[0].InstanceId" `
    --output text `
    --region $AWS_REGION 2>$null

if ($INSTANCE_ID -and $INSTANCE_ID -ne "None") {
    Ok "Instance already exists: $INSTANCE_ID"
} else {
    Log "Launching EC2 instance ($INSTANCE_TYPE, Ubuntu 24.04)..."
    $INSTANCE_ID = aws ec2 run-instances `
        --image-id $AMI_ID `
        --instance-type $INSTANCE_TYPE `
        --key-name $KEY_NAME `
        --security-group-ids $SG_ID `
        --block-device-mappings "[{`"DeviceName`":`"/dev/sda1`",`"Ebs`":{`"VolumeSize`":20,`"VolumeType`":`"gp3`"}}]" `
        --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME}]" `
        --query "Instances[0].InstanceId" `
        --output text `
        --region $AWS_REGION
    Ok "Launched: $INSTANCE_ID"
}

# ── 1d. Wait for instance + get public IP ─────────────────────────────────────
Log "Waiting for instance to be in 'running' state..."
aws ec2 wait instance-running --instance-ids $INSTANCE_ID --region $AWS_REGION
$EC2_IP = aws ec2 describe-instances `
    --instance-ids $INSTANCE_ID `
    --query "Reservations[0].Instances[0].PublicIpAddress" `
    --output text `
    --region $AWS_REGION
Ok "Instance running at: $EC2_IP"

# ── 1e. ECR Repositories ──────────────────────────────────────────────────────
Log "Creating ECR repositories"
foreach ($repo in @($ECR_API, $ECR_BUILDER)) {
    $exists = aws ecr describe-repositories --repository-names $repo --region $AWS_REGION 2>$null
    if ($exists) {
        Ok "$repo already exists"
    } else {
        aws ecr create-repository --repository-name $repo --region $AWS_REGION | Out-Null
        Ok "Created: $repo"
    }
}

} else {
    # Resume mode — look up existing instance IP
    Log "Resume mode: looking up existing EC2 instance"
    $EC2_IP = aws ec2 describe-instances `
        --filters "Name=tag:Name,Values=$INSTANCE_NAME" "Name=instance-state-name,Values=running" `
        --query "Reservations[0].Instances[0].PublicIpAddress" `
        --output text `
        --region $AWS_REGION
    if (-not $EC2_IP -or $EC2_IP -eq "None") { Err "Could not find running instance '$INSTANCE_NAME'" }
    Ok "Found instance at: $EC2_IP"
}

################################################################################
# PHASE 2 — BUILD AND PUSH DOCKER IMAGES
################################################################################

# ECR Login
Log "Logging in to ECR"
aws ecr get-login-password --region $AWS_REGION | `
    docker login --username AWS --password-stdin $ECR_BASE
Ok "ECR login successful"

# ── 2a. Build and push API ────────────────────────────────────────────────────
Log "Building API Docker image"
Push-Location apps\api
docker build -t "${ECR_API}:latest" .
if ($LASTEXITCODE -ne 0) { Err "Docker build failed for API" }
docker tag "${ECR_API}:latest" "$ECR_BASE/${ECR_API}:latest"
docker push "$ECR_BASE/${ECR_API}:latest"
if ($LASTEXITCODE -ne 0) { Err "Docker push failed for API" }
Ok "API image pushed"
Pop-Location

# ── 2b. Build and push Builder ────────────────────────────────────────────────
Log "Building Builder Docker image"
Push-Location apps\builder
docker build -t "${ECR_BUILDER}:latest" .
if ($LASTEXITCODE -ne 0) { Err "Docker build failed for Builder" }
docker tag "${ECR_BUILDER}:latest" "$ECR_BASE/${ECR_BUILDER}:latest"
docker push "$ECR_BASE/${ECR_BUILDER}:latest"
if ($LASTEXITCODE -ne 0) { Err "Docker push failed for Builder" }
Ok "Builder image pushed"
Pop-Location

################################################################################
# PHASE 3 — BUILD DASHBOARD STATIC FILES
################################################################################

Log "Building dashboard (production)"
Push-Location apps\dashboard
$env:VITE_API_BASE_URL       = "https://$API_DOMAIN"
$env:VITE_SUPABASE_URL       = "https://xkldqliccvgrfnckrlyw.supabase.co"
$env:VITE_SUPABASE_ANON_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrbGRxbGljY3ZncmZuY2tybHl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3Njk1MDksImV4cCI6MjA5MjM0NTUwOX0.M5GpFE1EFTA2abxv040bLx8HTJ338mg2URH3nWtF77o"
npm run build
if ($LASTEXITCODE -ne 0) { Err "Dashboard build failed" }
Ok "Dashboard built → dist/"
Pop-Location

################################################################################
# PHASE 4 — SERVER SETUP VIA SSH
################################################################################

# Helper: run a command on the remote server
function Remote($cmd) {
    ssh -i $KEY_PATH -o StrictHostKeyChecking=no -o ConnectTimeout=10 "ubuntu@$EC2_IP" $cmd
}

# Helper: SCP files to remote
function Upload($local, $remote) {
    scp -i $KEY_PATH -o StrictHostKeyChecking=no -r $local "ubuntu@${EC2_IP}:${remote}"
}

Log "Waiting 30s for SSH to become available on new instance..."
Start-Sleep -Seconds 30

# ── 4a. Install Docker + Nginx ────────────────────────────────────────────────
Log "Installing Docker and Nginx on EC2"
Remote @"
sudo apt-get update -q && \
sudo apt-get install -y -q nginx && \
curl -fsSL https://get.docker.com | sudo sh && \
sudo usermod -aG docker ubuntu && \
sudo systemctl enable nginx && \
sudo systemctl enable docker
"@
Ok "Docker and Nginx installed"

# ── 4b. Install AWS CLI + ECR Login on server ─────────────────────────────────
Log "Installing AWS CLI on EC2"
Remote @"
sudo apt-get install -y -q awscli
"@

# ── 4c. Upload dashboard static files ─────────────────────────────────────────
Log "Uploading dashboard static files"
Remote "sudo mkdir -p /var/www/dashboard && sudo chmod 777 /var/www/dashboard"
Upload "apps\dashboard\dist\*" "/var/www/dashboard/"
Remote "sudo chown -R www-data:www-data /var/www/dashboard"
Ok "Dashboard files uploaded"

# ── 4d. Write the API env file on the server ──────────────────────────────────
Log "Writing API environment file on EC2"
$envContent = @"
DATABASE_URL=postgresql://postgres.xkldqliccvgrfnckrlyw:Vinish%405152@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_DATABASE_URL=postgresql://postgres:Vinish%405152@db.xkldqliccvgrfnckrlyw.supabase.co:5432/postgres?sslmode=require
SUPABASE_URL=https://xkldqliccvgrfnckrlyw.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrbGRxbGljY3ZncmZuY2tybHl3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njc2OTUwOSwiZXhwIjoyMDkyMzQ1NTA5fQ.a-J7xSLL8K6670qZqZJWeSbRPZ-j1LFjl-1oWtoLQo0
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=AKIAWEIFB4NBUESIZAUV
AWS_SECRET_ACCESS_KEY=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
SQS_QUEUE_URL=https://sqs.ap-south-1.amazonaws.com/421454275395/servhub-mini-builds
S3_BUCKET_NAME=$S3_BUCKET
GITHUB_CLIENT_ID=Ov23liPayart2aVDYT6q
GITHUB_CLIENT_SECRET=9caaa64026e26f388d020399b7514827775e6642
GITHUB_WEBHOOK_SECRET=da64958975200d0867a7c16782d0cfe2696fb7e394743fef66f095a1951329bd
API_BASE_URL=https://$API_DOMAIN
PLATFORM_DOMAIN=$DOMAIN
PORT=3001
HOST=0.0.0.0
"@
# Write env file securely via heredoc over SSH
$envContent | ssh -i $KEY_PATH -o StrictHostKeyChecking=no "ubuntu@$EC2_IP" "sudo tee /etc/servhub.env > /dev/null && sudo chmod 600 /etc/servhub.env"
Ok "Environment file written"

# ── 4e. ECR Login + Pull + Run containers ─────────────────────────────────────
Log "Writing AWS credentials on EC2 for Docker awslogs driver"
Remote @"
sudo mkdir -p /root/.aws && \
sudo tee /root/.aws/credentials > /dev/null <<'CREDS'
[default]
aws_access_key_id=$AWS_ACCESS_KEY_ID
aws_secret_access_key=$AWS_SECRET_ACCESS_KEY
CREDS
sudo chmod 600 /root/.aws/credentials && \
sudo tee /root/.aws/config > /dev/null <<'CFG'
[default]
region=$AWS_REGION
CFG
"@
Ok "AWS credentials written for Docker daemon"

Log "Pulling and running Docker containers on EC2"
Remote @"
sudo sh -c 'aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_BASE' && \
sudo docker pull $ECR_BASE/${ECR_API}:latest && \
sudo docker pull $ECR_BASE/${ECR_BUILDER}:latest && \
sudo docker stop servhub-api servhub-builder 2>/dev/null || true && \
sudo docker rm   servhub-api servhub-builder 2>/dev/null || true && \
sudo docker run -d \
  --name servhub-api \
  --restart always \
  --env-file /etc/servhub.env \
  -p 3001:3001 \
  --log-driver awslogs \
  --log-opt awslogs-region=$AWS_REGION \
  --log-opt awslogs-group=/servhub/api \
  --log-opt awslogs-stream=servhub-api \
  --log-opt awslogs-create-group=true \
  $ECR_BASE/${ECR_API}:latest && \
sudo docker run -d \
  --name servhub-builder \
  --restart always \
  --env-file /etc/servhub.env \
  --log-driver awslogs \
  --log-opt awslogs-region=$AWS_REGION \
  --log-opt awslogs-group=/servhub/builder \
  --log-opt awslogs-stream=servhub-builder \
  --log-opt awslogs-create-group=true \
  $ECR_BASE/${ECR_BUILDER}:latest
"@
Ok "Containers started with CloudWatch logging"

# ── 4f. Write Nginx config ────────────────────────────────────────────────────
Log "Writing Nginx configuration"
$nginxConf = @"
server {
    listen 80;
    server_name $APP_DOMAIN;

    root /var/www/dashboard;
    index index.html;

    location / {
        try_files `$uri `$uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}

server {
    listen 80;
    server_name $API_DOMAIN;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host              `$host;
        proxy_set_header X-Real-IP         `$remote_addr;
        proxy_set_header X-Forwarded-For   `$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto `$scheme;
        proxy_set_header Upgrade           `$http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;
    }
}
"@
$nginxConf | ssh -i $KEY_PATH -o StrictHostKeyChecking=no "ubuntu@$EC2_IP" "sudo tee /etc/nginx/sites-available/servhub > /dev/null"
Remote @"
sudo ln -sf /etc/nginx/sites-available/servhub /etc/nginx/sites-enabled/servhub && \
sudo rm -f /etc/nginx/sites-enabled/default && \
sudo nginx -t && \
sudo systemctl reload nginx
"@
Ok "Nginx configured and reloaded"

################################################################################
# DONE
################################################################################

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  DEPLOYMENT COMPLETE" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
Write-Host "  EC2 Public IP : $EC2_IP" -ForegroundColor Yellow
Write-Host "  App URL       : https://$APP_DOMAIN" -ForegroundColor Yellow
Write-Host "  API URL       : https://$API_DOMAIN" -ForegroundColor Yellow
Write-Host ""
Write-Host "━━━ MANUAL STEPS REMAINING ━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Magenta
Write-Host ""
Write-Host "  1. CLOUDFLARE DNS → Add these two A records:" -ForegroundColor White
Write-Host "       servhub.$DOMAIN      →  $EC2_IP  (Proxied)" -ForegroundColor Gray
Write-Host "       api-servhub.$DOMAIN  →  $EC2_IP  (Proxied)" -ForegroundColor Gray
Write-Host "     SSL/TLS mode → set to 'Full'" -ForegroundColor Gray
Write-Host ""
Write-Host "  2. SUPABASE → Authentication → URL Configuration:" -ForegroundColor White
Write-Host "       Site URL     : https://$APP_DOMAIN" -ForegroundColor Gray
Write-Host "       Redirect URLs: https://$APP_DOMAIN/dashboard" -ForegroundColor Gray
Write-Host ""
Write-Host "  3. GITHUB OAuth App → Developer Settings → OAuth Apps:" -ForegroundColor White
Write-Host "       Homepage URL  : https://$APP_DOMAIN" -ForegroundColor Gray
Write-Host "       Callback URL  : https://xkldqliccvgrfnckrlyw.supabase.co/auth/v1/callback" -ForegroundColor Gray
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
Write-Host "SSH into server: ssh -i '$KEY_PATH' ubuntu@$EC2_IP" -ForegroundColor DarkGray
Write-Host "API logs       : ssh then 'sudo docker logs -f servhub-api'" -ForegroundColor DarkGray
Write-Host "Builder logs   : ssh then 'sudo docker logs -f servhub-builder'" -ForegroundColor DarkGray
