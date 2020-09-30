from tkinter import *



import sqlite3

con = sqlite3.connect("mydb.db")
cursor = con.cursor()
query0 = """
CREATE TABLE  contactos(contactoid integer primary key autoincrement, nombrecontacto text, numerocontacto integer, correocontacto text); """

query2 = """ SELECT * FROM contactos; """



ventana = Tk()
ventana.title("Agenda VyperCode")
ventana.geometry("1500x720")
Marco_menu = Frame(ventana, width = 40, height = 700, bg = "grey")

#opciones
label0= Label(Marco_menu, text= "Elija una opcion:")
label1= Label(Marco_menu, text= "Añadir Contactos")
label2= Label(Marco_menu, text= "Busqueda nombre")
label3= Label(Marco_menu, text= "Buscar por ID")
label4= Label(Marco_menu, text= "Borrar contactos")
label5= Label(Marco_menu, text= "Editar Contactos")

#Entrada de texto
e_texto = Entry(Marco_menu, font = ("arial 20"))


i = 0


# funciones tkinter
def click_boton(valor):
    global i
    e_texto.insert(i, valor)
    i += 1

# funciones
def insertar (nombrecontacto,numerocontacto,correocontacto):
   

   query1 = """ INSERT INTO contactos(nombrecontacto, numerocontacto, correocontacto) VALUES (?,?,?); """
   info_tupla = (nombrecontacto,numerocontacto,correocontacto)
   cursor.execute(query1, info_tupla)
   con.commit()
   print("Datos Guardados")

def busquedanombre(nombrecontacto):
    query3 = """ SELECT *  FROM contactos WHERE nombrecontacto = ? """
    cursor.execute(query3, (nombrecontacto,))
    res = cursor.fetchall()
    print(res)

def busquedanumero(numerocontacto):
    query4 = """ SELECT * FROM contactos WHERE numerocontacto = ? """
    cursor.execute(query4, (numerocontacto,))
    res = cursor.fetchall()
    print(res)

def borrar_Cont(nombrecontacto):
    query4 ="""DELETE FROM contactos WHERE nombrecontacto = ? """
    cursor.execute(query4, (nombrecontacto,))

def actualizarcontacto(nombrecontacto,numerocontacto,correocontacto,contactoid):
   query6 = """ UPDATE  contactos SET nombrecontacto = ?, numerocontacto = ?, correocontacto = ? where contactoid = ?; """
   cursor.execute(query6,[nombrecontacto,numerocontacto,correocontacto,contactoid])
   con.commit()

# def aceptar():

# def salir():
# Botones
boton1 = Button(Marco_menu, text = "Aceptar", width = 15, height = 2 , command = lambda: busquedanombre())
boton2 = Button(Marco_menu, text = "Salir", width = 15, height = 2 , command = lambda: borrar_Cont())

    

# Ubicacion en pantalla
Marco_menu.grid(row = 4, column = 9, padx = 20, pady = 50) 
e_texto.grid(row = 5, column = 0, padx = 50, pady =5)
boton1.grid(row = 6, column = 1, padx = 5 , pady = 5)
boton2.grid(row = 6, column = 2, padx = 5 , pady = 5)
#labels ubicacion
label0.grid(row = 4, column = 0, padx = 5 , pady = 5)
label1.grid(row = 4, column = 1, padx = 5 , pady = 5)
label2.grid(row = 4, column = 2, padx = 5 , pady = 5)
label3.grid(row = 4, column = 3, padx = 5 , pady = 5)
label4.grid(row = 4, column = 4, padx = 5 , pady = 5)
label5.grid(row = 4, column = 5, padx = 5 , pady = 5)




mainloop()

