import express = require('express');
import cors = require('cors');
import dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 5050;

app.use(cors());
app.use(express.json());

// TODO: connect to the database

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});