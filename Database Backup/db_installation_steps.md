## Installation

Install MySQL:
```
sudo apt install mysql-server
```
## Login

```
sudo mysql -u root
```
```
Set up MySQL password:
```
```
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY
'root';
FLUSH PRIVILEGES;
```
```
EXIT;
```
## Logging into DataBase 

```
mysql -u your_user(localhost in this case) -p
```
Enter password: [type your root password]
```
root
```
After Logging in Please add check the databases , Create a Databse and Create a Table to check at the time of Database Backup.
```
show databases;
```
```
CREATE DATABASE catalog_database;
```
```
use catalog_database;
```
```
CREATE TABLE Catalog(
  CatalogId INTEGER PRIMARY KEY,
  Journal VARCHAR(25),
  Publisher VARCHAR(25),
  Edition VARCHAR(25),
  Title VARCHAR(45),
  Author VARCHAR(25)
);
```
```
INSERT INTO Catalog 
VALUES('1','Muscle Magazine','Jude Mag', 'June 2013',
       'How to grow muscles','Muhammed Ali');
```
```
SELECT * 
FROM Catalog;
```
