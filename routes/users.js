const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Middleware to verify Clerk token
const verifyClerkToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    
    // Verify token with Clerk
    const response = await fetch('https://api.clerk.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const userData = await response.json();
    req.clerkUser = userData;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ error: 'Token verification failed' });
  }
};

// Create or update user (with token verification)
router.post('/users', verifyClerkToken, async (req, res) => {
  try {
    const { clerkUserId, email, firstName, lastName } = req.body;
    
    if (!clerkUserId || !email) {
      return res.status(400).json({ error: 'clerkUserId and email are required' });
    }

    // Verify that the token belongs to the user being created/updated
    if (req.clerkUser.id !== clerkUserId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Check if user already exists
    let user = await User.findOne({ clerkUserId });
    
    if (user) {
      // Update existing user
      user.email = email;
      user.firstName = firstName || user.firstName;
      user.lastName = lastName || user.lastName;
      await user.save();
    } else {
      // Create new user
      user = new User({
        clerkUserId,
        email,
        firstName,
        lastName
      });
      await user.save();
    }

    res.status(200).json({ 
      success: true, 
      user: {
        id: user._id,
        clerkUserId: user.clerkUserId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName
      }
    });
  } catch (error) {
    console.error('Error creating/updating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user by Clerk ID (with token verification)
router.get('/users/:clerkUserId', verifyClerkToken, async (req, res) => {
  try {
    const { clerkUserId } = req.params;
    
    // Verify that the token belongs to the user being accessed
    if (req.clerkUser.id !== clerkUserId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const user = await User.findOne({ clerkUserId });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({ 
      success: true, 
      user: {
        id: user._id,
        clerkUserId: user.clerkUserId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName
      }
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user (with token verification)
router.delete('/users/:clerkUserId', verifyClerkToken, async (req, res) => {
  try {
    const { clerkUserId } = req.params;
    
    // Verify that the token belongs to the user being deleted
    if (req.clerkUser.id !== clerkUserId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const user = await User.findOneAndDelete({ clerkUserId });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({ 
      success: true, 
      message: 'User deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router; 