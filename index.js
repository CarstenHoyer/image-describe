#!/usr/bin/env node

import "dotenv/config";
import fs from "fs-extra";
import path from "path";
import sharp from "sharp";
import OpenAI from "openai";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import pLimit from "p-limit";

// Initialize OpenAI client
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

import archiver from "archiver";

async function zipOutputDirectory(outputDir) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(`${outputDir}.zip`);
    const archive = archiver("zip", {
      zlib: { level: 9 }, // Set the compression level
    });

    output.on("close", () => {
      console.log(`Zipped output to ${outputDir}.zip`);
      resolve();
    });

    archive.on("error", (err) => {
      reject(err);
    });

    archive.pipe(output);
    archive.directory(outputDir, false); // False to not include the base directory
    archive.finalize();
  });
}

async function encodeImageToBase64(imagePath) {
  const imageBuffer = await fs.readFile(imagePath);
  return imageBuffer.toString("base64");
}

// Function to describe the image
async function describeImage(imagePath, triggerWord, userPrompt, systemPrompt) {
  try {
    const base64Image = await encodeImageToBase64(imagePath);
    const imageUrl = `data:image/jpeg;base64,${base64Image}`;

    // Create a chat completion with the image context
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Describe this image with the context of ${triggerWord}:`,
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
    });

    return response.choices[0].message?.content.trim();
  } catch (error) {
    console.error("Error describing image:", error);
    throw error;
  }
}

async function processImages(
  inputDir,
  outputDir,
  triggerWord,
  userPromptFile,
  zip
) {
  try {
    await fs.ensureDir(outputDir);
    const files = await fs.readdir(inputDir);
    const imageFiles = files.filter((file) => /\.(jpg|jpeg|png)$/i.test(file));

    const systemPrompt = `You are a professional photographer who specializes in capturing images of ${triggerWord}. You have been hired to describe a series of images for a photography exhibition. Provide a detailed description of each image with the context of ${triggerWord}.`;

    // Read the user prompt from the specified file
    const userPrompt = await fs.readFile(userPromptFile, "utf-8");

    // Set the limit for concurrent processing (adjust based on your needs and API limits)
    const limit = pLimit(10); // Change this number as needed to avoid rate limiting

    // Map over the image files and process them in parallel with concurrency limit
    const processingPromises = imageFiles.map((file) =>
      limit(async () => {
        const filePath = path.join(inputDir, file);
        const fileName = path.parse(file).name;

        // Generate the description for the image using OpenAI API
        const description = await describeImage(
          filePath,
          triggerWord,
          userPrompt,
          systemPrompt
        );

        const outputImagePath = path.join(outputDir, file);
        const outputTextPath = path.join(outputDir, `${fileName}.txt`);

        // Copy the image to the output directory
        await fs.copy(filePath, outputImagePath);
        // Write the description to a text file
        await fs.writeFile(outputTextPath, description, "utf-8");

        console.log(
          `Processed image: ${file} with description: "${description}"`
        );
      })
    );

    await Promise.all(processingPromises); // Wait for all processing to complete
    console.log("All images processed successfully.");

    // Zip the output directory if the zip argument is true
    if (zip) {
      await zipOutputDirectory(outputDir);
    }
  } catch (error) {
    console.error("Error processing images:", error);
  }
}

// Command-line argument parsing
const argv = yargs(hideBin(process.argv))
  .option("input-directory", {
    alias: "i",
    type: "string",
    description: "Directory containing images to process",
    default: "input",
  })
  .option("output-directory", {
    alias: "o",
    type: "string",
    description: "Directory to save processed images and descriptions",
    default: "output",
  })
  .option("trigger", {
    alias: "t",
    type: "string",
    description: "Trigger word for description context",
    default: "thr33",
  })
  .option("prompt", {
    alias: "p",
    type: "string",
    description: "Path to a prompt text file",
    default: "prompt.txt",
  })
  .option("zip", {
    alias: "z",
    type: "boolean",
    description: "Zip the output directory after processing",
    default: true,
  }).argv;

// Process the images based on command-line arguments
processImages(
  argv.inputDirectory,
  argv.outputDirectory,
  argv.trigger,
  argv.prompt,
  argv.zip
);
