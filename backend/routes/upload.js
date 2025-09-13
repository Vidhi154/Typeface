const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const { processReceipt } = require('../utils/receiptProcessor');
const { processBulkPDF } = require('../utils/pdfProcessor');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPG, PNG, and PDF files are allowed.'), false);
  }
};

const upload = multer({ 
  storage,
  fileFilter,
  limits: { 
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Process receipt upload
router.post('/receipt', auth, upload.single('receipt'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const fileUrl = `/uploads/${req.file.filename}`;

    try {
      // Process the receipt to extract transaction data
      const extractedData = await processReceipt(filePath, req.file.mimetype);
      
      res.json({
        message: 'Receipt processed successfully',
        fileUrl,
        extractedData,
        filename: req.file.filename
      });
    } catch (processingError) {
      // If processing fails, still return the file URL
      console.error('Receipt processing error:', processingError);
      res.json({
        message: 'Receipt uploaded but processing failed',
        fileUrl,
        extractedData: {
          amount: null,
          description: req.file.originalname,
          category: 'Other',
          date: new Date().toISOString().split('T')[0]
        },
        filename: req.file.filename,
        processingError: 'Could not extract data from receipt'
      });
    }
  } catch (error) {
    // Clean up file if it exists
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }
    
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'File too large. Maximum size is 5MB.' });
    }
    
    res.status(500).json({ 
      message: 'Error uploading receipt', 
      error: error.message 
    });
  }
});

// Process bulk transaction PDF
router.post('/bulk', auth, upload.single('transactionFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    if (req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({ message: 'Only PDF files are allowed for bulk upload' });
    }

    const filePath = req.file.path;

    try {
      // Process the PDF to extract transaction data
      const transactions = await processBulkPDF(filePath, req.user._id);
      
      // Clean up the uploaded file
      fs.unlink(filePath, () => {});
      
      res.json({
        message: 'Bulk transactions processed successfully',
        transactionCount: transactions.length,
        transactions: transactions.slice(0, 5) // Return first 5 as preview
      });
    } catch (processingError) {
      // Clean up file on processing error
      fs.unlink(filePath, () => {});
      throw processingError;
    }
  } catch (error) {
    // Clean up file if it exists
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }
    
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'File too large. Maximum size is 5MB.' });
    }
    
    res.status(500).json({ 
      message: 'Error processing bulk upload', 
      error: error.message 
    });
  }
});

// Get uploaded file
router.get('/file/:filename