# Build
docker build -t my-server .

# Tag
docker tag my-server:latest 718975140751.dkr.ecr.ap-south-1.amazonaws.com/my-server-repo:latest

# Push
docker push 718975140751.dkr.ecr.ap-south-1.amazonaws.com/my-server-repo:latest

# Deploy
aws ecs update-service \
  --cluster my-server-cluster-ecs \
  --service my-server-ecs-task-service \
  --force-new-deployment \
  --region ap-south-1