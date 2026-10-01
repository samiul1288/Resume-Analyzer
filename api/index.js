const { server, bootstrap, services } = require("../server");

module.exports = async (req, res) => {
  try {
    // Vercel serverless environment-এ সার্ভিস ইনিশিয়ালাইজ করা না থাকলে কানেক্ট করা
    if (!services.mongo || !services.firebase) {
      await bootstrap();
    }
    // HTTP Server instance-এর emit পদ্ধতি ব্যবহার করে রিকোয়েস্ট পাস করা
    server.emit("request", req, res);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: {
          message: "Database connection failed on serverless boot.",
          details: error.message,
        },
      }),
    );
  }
};
