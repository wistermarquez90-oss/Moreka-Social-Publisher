import "dotenv/config";
import { runPublishingWorker } from "../api/services/publishing-worker";

runPublishingWorker()
  .then((result) => {
    console.log(JSON.stringify(result));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
